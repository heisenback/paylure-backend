// src/transactions/transactions.service.ts
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { v4 as uuidv4 } from 'uuid';
import { QuickPixDto } from './dto/quick-pix.dto';
import { Deposit, Withdrawal } from '@prisma/client';

export type WithdrawalDto = {
  amount: number;
  pixKey: string;
  keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  description?: string;
};

export type UnifiedTransaction = {
    id: string;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number; // 🎯 JÁ EM CENTAVOS (não dividir aqui)
    status: string;
    date: Date;
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
        
        await this.keyclubService.createWithdrawal({
          amount: dto.amount,
          externalId: withdrawal.externalId,
          pix_key: dto.pixKey,
          key_type: keyTypeForKeyclub,
          description: dto.description || 'Saque Paylure',
          clientCallbackUrl: `${process.env.API_URL}/keyclub/withdrawal-callback`, 
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

  // 🎯 CORREÇÃO: Retornar valores em CENTAVOS (não dividir)
  async getHistory(userId: string): Promise<UnifiedTransaction[]> {
    this.logger.log(`📋 Buscando histórico para userId: ${userId}`);
    
    const deposits = await this.prisma.deposit.findMany({
      where: { 
        userId,
        status: { in: ['PENDING', 'PAID', 'COMPLETED', 'CONFIRMED'] } // 🎯 Incluir todos os status relevantes
      },
      select: {
        id: true,
        amountInCents: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { 
        userId,
        status: { in: ['PENDING', 'COMPLETED', 'CONFIRMED', 'FAILED'] } // 🎯 Incluir todos os status
      },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const history = [
      ...deposits.map(d => ({
        id: d.id,
        type: 'DEPOSIT' as const,
        amount: d.amountInCents, // 🎯 JÁ EM CENTAVOS
        status: d.status,
        date: d.createdAt,
      })),
      ...withdrawals.map(w => ({
        id: w.id,
        type: 'WITHDRAWAL' as const,
        amount: w.amount, // 🎯 JÁ EM CENTAVOS
        status: w.status,
        date: w.createdAt,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());
    
    this.logger.log(`✅ Histórico encontrado: ${history.length} transações`);
    
    return history;
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
      const keyclubResponse = await this.keyclubService.createDeposit({
        amount: dto.amount,
        externalId: deposit.externalId,
        payer: {
          name: dto.payerName,
          email: dto.payerEmail,
          document: dto.payerDocument,
        },
        clientCallbackUrl: `${process.env.API_URL}/keyclub/callback/${deposit.webhookToken}`,
      });
      
      return {
        deposit,
        pixCode: keyclubResponse.pixCode,
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