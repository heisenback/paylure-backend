// src/admin/admin.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KeyclubService } from '../keyclub/keyclub.service'; // 👈 Novo Import

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService, // 👈 Injeção do KeyClub
  ) {}

  // ===================================
  // 📊 DASHBOARD - ESTATÍSTICAS GERAIS
  // ===================================
  async getDashboardStats() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Consultas paralelas para performance
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
      this.prisma.deposit.aggregate({
        where: { status: 'CONFIRMED' },
        _sum: { netAmountInCents: true },
        _count: true,
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.deposit.aggregate({
        where: { status: 'CONFIRMED', createdAt: { gte: today } },
        _sum: { netAmountInCents: true },
        _count: true,
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: today } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.deposit.aggregate({
        where: { status: 'CONFIRMED', createdAt: { gte: thisWeekStart } },
        _sum: { netAmountInCents: true },
        _count: true,
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: thisWeekStart } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.deposit.aggregate({
        where: { status: 'CONFIRMED', createdAt: { gte: thisMonthStart } },
        _sum: { netAmountInCents: true },
        _count: true,
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: thisMonthStart } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.user.aggregate({
        _sum: { balance: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
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
  // 📈 GRÁFICO - DEPÓSITOS
  // ===================================
  async getDepositsChart(days: number = 7): Promise<Array<{ date: string; amount: number; count: number }>> {
    const data: Array<{ date: string; amount: number; count: number }> = [];
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

      data.push({
        date: date.toISOString().split('T')[0],
        amount: result._sum.netAmountInCents || 0,
        count: result._count,
      });
    }
    return data;
  }

  // ===================================
  // 📉 GRÁFICO - SAQUES
  // ===================================
  async getWithdrawalsChart(days: number = 7): Promise<Array<{ date: string; amount: number; count: number }>> {
    const data: Array<{ date: string; amount: number; count: number }> = [];
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

      data.push({
        date: date.toISOString().split('T')[0],
        amount: result._sum.amount || 0,
        count: result._count,
      });
    }
    return data;
  }

  // ===================================
  // 👥 LISTAR TODOS OS USUÁRIOS
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
          skip: type === 'DEPOSIT' ? skip : 0,
          take: type === 'DEPOSIT' ? limit : 10,
          where: status ? { status } : undefined,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { email: true, name: true } } },
        })
      : [];

    const withdrawals: any[] = (!type || type === 'WITHDRAWAL')
      ? await this.prisma.withdrawal.findMany({
          skip: type === 'WITHDRAWAL' ? skip : 0,
          take: type === 'WITHDRAWAL' ? limit : 10,
          where: status ? { status } : undefined,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { email: true, name: true } } },
        })
      : [];

    const transactions = [
      ...deposits.map((d: any) => ({ ...d, type: 'DEPOSIT' })),
      ...withdrawals.map((w: any) => ({ ...w, type: 'WITHDRAWAL' })),
    ].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());

    return { transactions: transactions.slice(0, limit), pagination: { page, limit } };
  }

  // ===================================
  // 🔄 MUDAR SAQUE AUTOMÁTICO
  // ===================================
  async toggleAutoWithdrawal(userId: string, enabled: boolean) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isAutoWithdrawal: enabled },
      select: { id: true, email: true, isAutoWithdrawal: true }
    });
    this.logger.log(`⚙️ Saque automático para ${user.email} definido como: ${enabled}`);
    return { success: true, user };
  }

  // ===================================
  // 💰 GERENCIAR SALDO MANUALMENTE
  // ===================================
  async manageUserBalance(userId: string, type: 'ADD' | 'REMOVE', amount: number, description?: string) {
    if (amount <= 0) throw new BadRequestException('Valor deve ser positivo');

    return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new BadRequestException('Usuário não encontrado');

      if (type === 'REMOVE' && user.balance < amount) {
        throw new BadRequestException('Saldo insuficiente para remoção');
      }

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: type === 'ADD' ? { increment: amount } : { decrement: amount } }
      });

      await tx.transaction.create({
        data: {
          userId,
          type: type === 'ADD' ? 'DEPOSIT' : 'WITHDRAWAL',
          amount: amount,
          status: 'COMPLETED',
          description: description || (type === 'ADD' ? 'Ajuste Admin (Crédito)' : 'Ajuste Admin (Débito)'),
          referenceId: `ADMIN-ADJ-${Date.now()}`,
          metadata: { type: 'ADMIN_ADJUSTMENT', adminAction: type }
        }
      });

      this.logger.log(`💰 Saldo user ${user.email} ajustado: ${type} ${amount}. Novo: ${updatedUser.balance}`);
      return { success: true, newBalance: updatedUser.balance };
    });
  }

  // ===================================
  // ✅ APROVAR SAQUE MANUAL (NOVO)
  // ===================================
  async approveWithdrawal(withdrawalId: string, adminId: string) {
    this.logger.log(`[ADMIN] Aprovando saque ${withdrawalId} (Admin: ${adminId})`);

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true }
    });

    if (!withdrawal) throw new NotFoundException('Saque não encontrado.');

    if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Saque não está pendente. Status atual: ${withdrawal.status}`);
    }

    const amountInReais = withdrawal.netAmount / 100; 
    const keyTypeForKeyclub = withdrawal.keyType === 'RANDOM' ? 'EVP' : withdrawal.keyType;

    try {
      this.logger.log(`💸 Enviando PIX de R$ ${amountInReais} para ${withdrawal.pixKey}`);
      
      await this.keyclubService.createWithdrawal({
        amount: amountInReais,
        externalId: withdrawal.externalId,
        pixKey: withdrawal.pixKey,
        pixKeyType: keyTypeForKeyclub,
      });

      const updated = await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'COMPLETED',
          description: withdrawal.description ? `${withdrawal.description} (Aprovado por Admin)` : 'Aprovado manualmente',
        }
      });

      return { success: true, message: 'Saque aprovado e enviado!', withdrawal: updated };

    } catch (error: any) {
      this.logger.error(`❌ Falha ao aprovar saque: ${error.message}`);
      throw new BadRequestException(`Erro ao processar pagamento: ${error.message}`);
    }
  }

  // ===================================
  // ❌ REJEITAR SAQUE MANUAL (NOVO)
  // ===================================
  async rejectWithdrawal(withdrawalId: string, reason: string, adminId: string) {
    this.logger.log(`[ADMIN] Rejeitando saque ${withdrawalId}. Motivo: ${reason}`);

    return await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });

      if (!withdrawal) throw new NotFoundException('Saque não encontrado.');

      if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(`Impossível rejeitar. Status atual: ${withdrawal.status}`);
      }

      await tx.user.update({
        where: { id: withdrawal.userId },
        data: { balance: { increment: withdrawal.amount } }
      });

      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', failureReason: reason || 'Rejeitado pelo administrador' }
      });

      await tx.transaction.create({
        data: {
          userId: withdrawal.userId,
          type: 'DEPOSIT',
          amount: withdrawal.amount,
          status: 'COMPLETED',
          description: `Estorno de saque #${withdrawal.id.slice(0,8)}`,
          referenceId: withdrawal.externalId,
          metadata: { reason, adminAction: 'REJECT' }
        }
      });

      return { success: true, message: 'Saque rejeitado e saldo estornado.', withdrawal: updated };
    });
  }
}