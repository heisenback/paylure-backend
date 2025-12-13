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

// Tipo Unificado que o Frontend espera
export type UnifiedTransaction = {
    id: string;
    type: string; // 'SALE' | 'DEPOSIT' | 'WITHDRAWAL'
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
};

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  // ===========================================================================
  // 1. HISTÓRICO UNIFICADO (CORREÇÃO: LÊ A TABELA 'TRANSACTION')
  // ===========================================================================
  async getHistory(userId: string, options: HistoryOptions): Promise<HistoryResponseData> {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    this.logger.log(`📋 Buscando histórico para User: ${userId} (Status: ${status})`);
    
    // Filtro Base
    const where: Prisma.TransactionWhereInput = { userId };

    // Filtros de Status
    if (status !== 'ALL') {
        if (status === 'PENDING') {
            where.status = 'PENDING';
        } else if (status === 'CONFIRMED' || status === 'COMPLETED') {
            where.status = { in: ['COMPLETED', 'CONFIRMED', 'PAID'] };
        } else if (status === 'FAILED') {
            where.status = { in: ['FAILED', 'REJECTED'] };
        }
    }

    // 1. Busca Total (para paginação)
    const totalItems = await this.prisma.transaction.count({ where });

    // 2. Busca Dados (na tabela certa!)
    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
          product: { select: { name: true } } // Traz nome do produto
      }
    });

    // 3. Mapeia para o formato do Front
    const mappedTransactions: UnifiedTransaction[] = transactions.map(t => ({
        id: t.id,
        type: t.type,           // Retorna SALE, DEPOSIT ou WITHDRAWAL
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

  // ===========================================================================
  // 2. SAQUE (GRAVA NA TRANSACTION)
  // ===========================================================================
  async createWithdrawal(userId: string, dto: WithdrawalDto) {
    const amountInCents = Math.round(dto.amount * 100);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      if (user.balance < amountInCents) throw new BadRequestException('Saldo insuficiente.');

      const externalId = uuidv4();

      // A. Cria Saque
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

      // B. Debita Saldo
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amountInCents } },
      });

      // C. ✅ Grava no Extrato Unificado
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

      // D. Gateway
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

  // ===========================================================================
  // 3. PIX RÁPIDO (GRAVA NA TRANSACTION)
  // ===========================================================================
  async createQuickPix(userId: string, merchantId: string, dto: QuickPixDto) {
    const amountInCents = Math.round(dto.amount * 100);
    const externalId = uuidv4();

    // A. Cria Depósito
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

    // B. ✅ Grava no Extrato Unificado (Tipo DEPOSIT)
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