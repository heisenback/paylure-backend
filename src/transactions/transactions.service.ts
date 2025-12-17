// src/transactions/transactions.service.ts
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { v4 as uuidv4 } from 'uuid';
import { QuickPixDto } from './dto/quick-pix.dto';
import { Prisma } from '@prisma/client';

export type WithdrawalDto = {
  amount: number;
  pixKey: string;
  keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  description?: string;
};

export type UnifiedTransaction = {
    id: string;
    type: string;
    amountInCents: number;
    status: string;
    createdAt: Date;
    description?: string;
    customerName?: string;
    customerEmail?: string;
};

export type HistoryResponseData = {
  transactions: UnifiedTransaction[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    limit: number;
  };
};

export type HistoryOptions = {
  page: number;
  limit: number;
  status: string;
  // ✅ ADICIONADO NO TYPE
  startDate?: string;
  endDate?: string;
};

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  async getHistory(userId: string, options: HistoryOptions): Promise<HistoryResponseData> {
    const { page, limit, status, startDate, endDate } = options;
    const skip = (page - 1) * limit;

    this.logger.log(`📋 Buscando histórico User: ${userId} | Status: ${status} | De: ${startDate} Até: ${endDate}`);
    
    const where: Prisma.TransactionWhereInput = { userId };

    // ✅ LÓGICA DE DATAS ADICIONADA
    if (startDate && endDate) {
        // Ajusta o endDate para o final do dia (23:59:59) para pegar o dia todo
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        where.createdAt = {
            gte: start,
            lte: end
        };
    }

    if (status !== 'ALL') {
        if (status === 'PENDING') {
            where.status = 'PENDING';
        } else if (status === 'CONFIRMED' || status === 'COMPLETED') {
            where.status = { in: ['COMPLETED', 'CONFIRMED', 'PAID', 'APPROVED'] };
        } else if (status === 'FAILED') {
            where.status = { in: ['FAILED', 'REJECTED'] };
        }
    }

    const totalItems = await this.prisma.transaction.count({ where });

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
          product: { select: { name: true } }
      }
    });

    const mappedTransactions: UnifiedTransaction[] = transactions.map(t => ({
        id: t.id,
        type: t.type,
        amountInCents: t.amount,
        status: t.status,
        createdAt: t.createdAt,
        description: t.description || t.product?.name || (t.type === 'SALE' ? 'Venda de Produto' : 'Transação'),
        customerName: t.customerName || undefined,
        customerEmail: t.customerEmail || undefined
    }));
    
    return {
      transactions: mappedTransactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems: totalItems,
        limit: limit,
      },
    };
  }

  // ... (Mantenha createWithdrawal e createQuickPix iguais, não mudaram)
  async createWithdrawal(userId: string, dto: WithdrawalDto) {
    const amountInCents = Math.round(dto.amount * 100);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      if (user.balance < amountInCents) throw new BadRequestException('Saldo insuficiente.');

      const externalId = uuidv4();

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amount: amountInCents,
          status: 'PENDING',
          pixKey: dto.pixKey,
          keyType: dto.keyType,
          description: dto.description,
          externalId,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amountInCents } },
      });

      await tx.transaction.create({
          data: {
              userId,
              type: 'WITHDRAWAL',
              amount: amountInCents,
              status: 'PENDING',
              description: dto.description || 'Solicitação de Saque',
              referenceId: withdrawal.id,
              externalId: externalId,
              paymentMethod: 'PIX'
          }
      });

      try {
        const keyTypeForKeyclub = dto.keyType === 'RANDOM' ? 'EVP' : dto.keyType;
        await this.keyclubService.createWithdrawal({
          amount: dto.amount,
          externalId: withdrawal.externalId,
          pixKey: dto.pixKey,
          pixKeyType: keyTypeForKeyclub,
        });
      } catch (error) {
        this.logger.error(`Falha KeyClub Saque`, error);
        throw new BadRequestException('Erro no gateway de pagamento.');
      }

      return withdrawal;
    });
  }

  async createQuickPix(userId: string, merchantId: string, dto: QuickPixDto) {
    const amountInCents = Math.round(dto.amount * 100);
    const externalId = uuidv4();

    const deposit = await this.prisma.deposit.create({
      data: {
        amountInCents,
        netAmountInCents: amountInCents,
        status: 'PENDING',
        userId,
        merchantId,
        payerName: dto.payerName,
        payerEmail: dto.payerEmail,
        payerDocument: dto.payerDocument,
        externalId,
        webhookToken: uuidv4(),
      },
    });

    await this.prisma.transaction.create({
        data: {
            userId,
            type: 'DEPOSIT',
            amount: amountInCents,
            status: 'PENDING',
            description: 'Depósito Rápido via Dashboard',
            referenceId: deposit.id,
            externalId: externalId,
            paymentMethod: 'PIX',
            customerName: dto.payerName
        }
    });

    try {
      const keyclubResponse = await this.keyclubService.createDeposit({
        amount: dto.amount,
        externalId: deposit.externalId,
        payerName: dto.payerName,
        payerEmail: dto.payerEmail,
        payerDocument: dto.payerDocument,
      });
      
      return {
        deposit,
        pixCode: keyclubResponse.qrcode,
      };

    } catch (error) {
        this.logger.error(`Erro KeyClub QuickPix`, error);
        await this.prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED' } });
        throw new BadRequestException('Erro ao gerar PIX.');
    }
  }
}