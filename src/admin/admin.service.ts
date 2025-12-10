// src/admin/admin.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KeyclubService } from '../keyclub/keyclub.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  // 🔥 HELPER: Formatação de Chave Pix
  private formatPixKey(key: string, type: string): string {
    const clean = key.replace(/\D/g, '');
    if (type === 'CPF' && clean.length === 11) {
      return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    if (type === 'CNPJ' && clean.length === 14) {
      return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    if (type === 'PHONE' || type === 'TELEFONE') {
        return clean; 
    }
    return key;
  }

  // ===================================
  // 📊 DASHBOARD - ESTATÍSTICAS
  // ===================================
  async getDashboardStats() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalDeposits,
      totalWithdrawals,
      depositsToday,
      withdrawalsToday,
      depositsThisWeek,
      withdrawalsThisWeek,
      depositsThisMonth,
      withdrawalsThisMonth,
      totalBalance,
      pendingWithdrawals,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.deposit.aggregate({ where: { status: 'CONFIRMED' }, _sum: { netAmountInCents: true }, _count: true }),
      this.prisma.withdrawal.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: true }),
      this.prisma.deposit.aggregate({ where: { status: 'CONFIRMED', createdAt: { gte: today } }, _sum: { netAmountInCents: true }, _count: true }),
      this.prisma.withdrawal.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: today } }, _sum: { amount: true }, _count: true }),
      this.prisma.deposit.aggregate({ where: { status: 'CONFIRMED', createdAt: { gte: thisWeekStart } }, _sum: { netAmountInCents: true }, _count: true }),
      this.prisma.withdrawal.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: thisWeekStart } }, _sum: { amount: true }, _count: true }),
      this.prisma.deposit.aggregate({ where: { status: 'CONFIRMED', createdAt: { gte: thisMonthStart } }, _sum: { netAmountInCents: true }, _count: true }),
      this.prisma.withdrawal.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: thisMonthStart } }, _sum: { amount: true }, _count: true }),
      this.prisma.user.aggregate({ _sum: { balance: true } }),
      this.prisma.withdrawal.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true }, _count: true }),
    ]);

    const totalFeesCollected = await this.prisma.withdrawal.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { feeAmount: true },
    });

    return {
      users: { total: totalUsers },
      deposits: {
        total: { amount: totalDeposits._sum.netAmountInCents || 0, count: totalDeposits._count },
        today: { amount: depositsToday._sum.netAmountInCents || 0, count: depositsToday._count },
        thisWeek: { amount: depositsThisWeek._sum.netAmountInCents || 0, count: depositsThisWeek._count },
        thisMonth: { amount: depositsThisMonth._sum.netAmountInCents || 0, count: depositsThisMonth._count },
      },
      withdrawals: {
        total: { amount: totalWithdrawals._sum.amount || 0, count: totalWithdrawals._count },
        today: { amount: withdrawalsToday._sum.amount || 0, count: withdrawalsToday._count },
        thisWeek: { amount: withdrawalsThisWeek._sum.amount || 0, count: withdrawalsThisWeek._count },
        thisMonth: { amount: withdrawalsThisMonth._sum.amount || 0, count: withdrawalsThisMonth._count },
        pending: { amount: pendingWithdrawals._sum.amount || 0, count: pendingWithdrawals._count },
      },
      balance: { totalInCirculation: totalBalance._sum.balance || 0 },
      fees: { totalCollected: totalFeesCollected._sum.feeAmount || 0 },
    };
  }

  // ===================================
  // 📈 GRÁFICOS
  // ===================================
  async getDepositsChart(days: number = 7) {
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      const result = await this.prisma.deposit.aggregate({
        where: { status: 'CONFIRMED', createdAt: { gte: date, lt: nextDate } },
        _sum: { netAmountInCents: true },
        _count: true,
      });

      data.push({ date: date.toISOString().split('T')[0], amount: result._sum.netAmountInCents || 0, count: result._count });
    }
    return data;
  }

  async getWithdrawalsChart(days: number = 7) {
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);

      const result = await this.prisma.withdrawal.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: date, lt: nextDate } },
        _sum: { amount: true },
        _count: true,
      });

      data.push({ date: date.toISOString().split('T')[0], amount: result._sum.amount || 0, count: result._count });
    }
    return data;
  }

  // ===================================
  // 👥 LISTAR USUÁRIOS
  // ===================================
  async getAllUsers(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, name: true, balance: true, role: true, document: true,
          isAutoWithdrawal: true, createdAt: true,
          // 👇 AQUI ESTAVA O PROBLEMA! ADICIONEI OS CAMPOS QUE FALTAVAM
          withdrawalFeePercent: true, 
          withdrawalFeeFixed: true, 
          // 👆 FIM DA CORREÇÃO
          _count: { select: { deposits: true, withdrawals: true } },
        },
      }),
      this.prisma.user.count(),
    ]);
    return { users, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // ===================================
  // 💰 LISTAR TRANSAÇÕES
  // ===================================
  async getAllTransactions(page: number = 1, limit: number = 50, type?: 'DEPOSIT' | 'WITHDRAWAL', status?: string) {
    const skip = (page - 1) * limit;
    const deposits: any[] = (!type || type === 'DEPOSIT')
      ? await this.prisma.deposit.findMany({
          skip: type === 'DEPOSIT' ? skip : 0, take: type === 'DEPOSIT' ? limit : 10,
          where: status ? { status } : undefined, orderBy: { createdAt: 'desc' },
          include: { user: { select: { email: true, name: true } } },
        }) : [];

    const withdrawals: any[] = (!type || type === 'WITHDRAWAL')
      ? await this.prisma.withdrawal.findMany({
          skip: type === 'WITHDRAWAL' ? skip : 0, take: type === 'WITHDRAWAL' ? limit : 10,
          where: status ? { status } : undefined, orderBy: { createdAt: 'desc' },
          include: { user: { select: { email: true, name: true } } },
        }) : [];

    const transactions = [...deposits.map(d => ({ ...d, type: 'DEPOSIT' })), ...withdrawals.map(w => ({ ...w, type: 'WITHDRAWAL' }))]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { transactions: transactions.slice(0, limit), pagination: { page, limit } };
  }

  // ===================================
  // 🔄 SAQUE AUTOMÁTICO & SALDO
  // ===================================
  async toggleAutoWithdrawal(userId: string, enabled: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId }, data: { isAutoWithdrawal: enabled },
      select: { id: true, email: true, isAutoWithdrawal: true }
    });
    return { success: true, user };
  }

  async manageUserBalance(userId: string, type: 'ADD' | 'REMOVE', amount: number, description?: string) {
    if (amount <= 0) throw new BadRequestException('Valor deve ser positivo');
    return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new BadRequestException('Usuário não encontrado');
      if (type === 'REMOVE' && user.balance < amount) throw new BadRequestException('Saldo insuficiente');

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: type === 'ADD' ? { increment: amount } : { decrement: amount } }
      });

      await tx.transaction.create({
        data: {
          userId, type: type === 'ADD' ? 'DEPOSIT' : 'WITHDRAWAL', amount, status: 'COMPLETED',
          description: description || `Ajuste Admin (${type})`,
          referenceId: `ADMIN-ADJ-${Date.now()}`, metadata: { type: 'ADMIN_ADJUSTMENT', adminAction: type }
        }
      });
      return { success: true, newBalance: updatedUser.balance };
    });
  }

  // ===================================
  // ✅ APROVAR/REJEITAR SAQUE
  // ===================================
  async approveWithdrawal(withdrawalId: string, adminId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundException('Saque não encontrado.');
    if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PENDING_APPROVAL') throw new BadRequestException('Status inválido');

    const amountInReais = withdrawal.netAmount / 100;
    const newExternalId = uuidv4();
    const formattedKey = this.formatPixKey(withdrawal.pixKey, withdrawal.keyType);
    const callbackUrl = `${process.env.API_URL || 'https://api.paylure.com.br'}/api/v1/webhooks/keyclub/${withdrawal.webhookToken || uuidv4()}`;

    try {
      await this.keyclubService.createWithdrawal({
        amount: amountInReais, externalId: newExternalId, pixKey: formattedKey,
        pixKeyType: (withdrawal.keyType === 'RANDOM' ? 'EVP' : withdrawal.keyType) as any,
        clientCallbackUrl: callbackUrl, description: `Aprovado Manualmente`
      });

      return { success: true, message: 'Saque enviado!', withdrawal: await this.prisma.withdrawal.update({
        where: { id: withdrawalId }, data: { status: 'COMPLETED', externalId: newExternalId, description: 'Aprovado manualmente' }
      })};
    } catch (error: any) {
      this.logger.error(`❌ Falha: ${error.message}`);
      throw new BadRequestException(`Erro ao processar: ${error.message}`);
    }
  }

  async rejectWithdrawal(withdrawalId: string, reason: string, adminId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal || (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PENDING_APPROVAL')) throw new BadRequestException('Saque inválido para rejeição');

      await tx.user.update({ where: { id: withdrawal.userId }, data: { balance: { increment: withdrawal.amount } } });
      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId }, data: { status: 'REJECTED', failureReason: reason }
      });

      await tx.transaction.create({
        data: {
          userId: withdrawal.userId, type: 'DEPOSIT', amount: withdrawal.amount, status: 'COMPLETED',
          description: `Estorno de saque rejeitado`, referenceId: withdrawal.externalId, metadata: { reason, adminAction: 'REJECT' }
        }
      });
      return { success: true, message: 'Saque rejeitado.', withdrawal: updated };
    });
  }

  // ===================================
  // 🚩 FEATURE FLAGS (LÓGICA NOVA)
  // ===================================
  async getFeatureFlags() {
    try {
        // Tenta buscar na tabela systemSetting.
        const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'feature_flags' } });
        return setting ? JSON.parse(setting.value) : {};
    } catch (error) {
        this.logger.warn('Erro ao ler feature flags (tabela pode não existir). Retornando padrão.');
        return {};
    }
  }

  async updateFeatureFlags(flags: any) {
    const key = 'feature_flags';
    const value = JSON.stringify(flags);
    
    // Salva ou Atualiza
    return await this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
    });
  }
}