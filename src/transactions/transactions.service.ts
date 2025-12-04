// src/transactions/transactions.service.ts
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { v4 as uuidv4 } from 'uuid';
import { QuickPixDto } from './dto/quick-pix.dto';
import { Deposit, Prisma, Withdrawal } from '@prisma/client';

export type WithdrawalDto = {
  amount: number;
  pixKey: string;
  keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  description?: string;
};

export type UnifiedTransaction = {
    id: string;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    amountInCents: number;
    status: string;
    createdAt: Date;
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
};

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  async findDepositById(depositId: string, userId: string) {
      return this.prisma.deposit.findFirst({
          where: {
              id: depositId,
              userId: userId, 
          },
      });
  }

  async createWithdrawal(userId: string, dto: WithdrawalDto) {
    const amountInCents = Math.round(dto.amount * 100);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }
      
      if (user.balance < amountInCents) {
        throw new BadRequestException('Saldo insuficiente para o saque.');
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: userId,
          amount: amountInCents,
          status: 'PENDING',
          pixKey: dto.pixKey,
          keyType: dto.keyType,
          description: dto.description,
          externalId: uuidv4(),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          balance: {
            decrement: amountInCents,
          },
        },
      });

      try {
        const keyTypeForKeyclub = dto.keyType === 'RANDOM' ? 'EVP' : dto.keyType;
        
        // ✅ CORRIGIDO: pixKeyType (não keyType)
        await this.keyclubService.createWithdrawal({
          amount: dto.amount,
          externalId: withdrawal.externalId,
          pixKey: dto.pixKey,
          pixKeyType: keyTypeForKeyclub,
        });

      } catch (error) {
        this.logger.error(`Falha no KeyClub para Saque ${withdrawal.id}. Estornando saldo.`, error);

        await tx.user.update({
          where: { id: userId },
          data: {
            balance: {
              increment: amountInCents,
            },
          },
        });
        
        await tx.withdrawal.update({
            where: { id: withdrawal.id },
            data: {
                status: 'FAILED',
                failureReason: 'Falha na comunicação inicial com o KeyClub.',
            },
        });

        throw new BadRequestException('Erro ao processar o saque: Falha de comunicação com o sistema de pagamentos.');
      }

      return withdrawal;
    });
  }

  async getHistory(userId: string, options: HistoryOptions): Promise<HistoryResponseData> {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    this.logger.log(`📋 Buscando histórico para userId: ${userId} (Página: ${page}, Filtro: ${status})`);
    
    let depositWhere: Prisma.DepositWhereInput = { userId };
    let withdrawalWhere: Prisma.WithdrawalWhereInput = { userId };

    if (status === 'PENDING') {
      depositWhere.status = 'PENDING';
      withdrawalWhere.status = 'PENDING';
    } else if (status === 'CONFIRMED') {
      depositWhere.status = 'CONFIRMED';
      withdrawalWhere.status = 'COMPLETED';
    } else if (status === 'FAILED') {
      depositWhere.status = 'FAILED';
      withdrawalWhere.status = 'FAILED';
    } else if (status === 'ALL') {
      depositWhere.status = { in: ['PENDING', 'CONFIRMED', 'FAILED'] };
      withdrawalWhere.status = { in: ['PENDING', 'COMPLETED', 'FAILED'] };
    }

    const deposits = await this.prisma.deposit.findMany({
      where: depositWhere,
      select: {
        id: true,
        amountInCents: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const withdrawals = await this.prisma.withdrawal.findMany({
      where: withdrawalWhere,
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const history: UnifiedTransaction[] = [
      ...deposits.map(d => ({
        id: d.id,
        type: 'DEPOSIT' as const,
        amountInCents: d.amountInCents,
        status: d.status,
        createdAt: d.createdAt,
      })),
      ...withdrawals.map(w => ({
        id: w.id,
        type: 'WITHDRAWAL' as const,
        amountInCents: w.amount,
        status: w.status,
        createdAt: w.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    const totalItems = history.length;
    const totalPages = Math.ceil(totalItems / limit);
    const transactions = history.slice(skip, skip + limit);
    
    this.logger.log(`✅ Histórico encontrado: ${transactions.length} de ${totalItems} transações`);
    
    return {
      transactions,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems,
        limit: limit,
      },
    };
  }

  async createQuickPix(userId: string, merchantId: string, dto: QuickPixDto) {
    const amountInCents = Math.round(dto.amount * 100);

    const deposit = await this.prisma.deposit.create({
      data: {
        amountInCents: amountInCents,
        feeInCents: 0,
        sellerFeeInCents: 0,
        netAmountInCents: amountInCents,
        status: 'PENDING',
        userId: userId,
        merchantId: merchantId,
        payerName: dto.payerName,
        payerEmail: dto.payerEmail,
        payerDocument: dto.payerDocument,
        externalId: uuidv4(),
        webhookToken: uuidv4(),
      },
    });

    try {
      // ✅ CORRIGIDO: Formato correto da interface CreateDepositRequest
      const keyclubResponse = await this.keyclubService.createDeposit({
        amount: dto.amount,
        externalId: deposit.externalId,
        payerName: dto.payerName,
        payerEmail: dto.payerEmail,
        payerDocument: dto.payerDocument,
      });
      
      // ✅ CORRIGIDO: qrcode (não pixCode)
      return {
        deposit,
        pixCode: keyclubResponse.qrcode,
      };

    } catch (error) {
        this.logger.error(`Falha ao gerar PIX no KeyClub para o depósito ${deposit.id}.`, error);

        await this.prisma.deposit.update({
            where: { id: deposit.id },
            data: { status: 'FAILED' },
        });
        
        throw new BadRequestException('Erro ao gerar o PIX: Falha de comunicação com o sistema de pagamentos.');
    }
  }
}