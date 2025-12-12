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
  // 1. HISTÓRICO UNIFICADO (A CORREÇÃO PRINCIPAL)
  // Agora lê da tabela 'Transaction', onde as vendas (SALE) estão salvas corretamente.
  // ===========================================================================
  async getHistory(userId: string, options: HistoryOptions) {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    this.logger.log(`📋 Buscando histórico unificado para User: ${userId} (Status: ${status})`);
    
    // Filtros dinâmicos
    const where: Prisma.TransactionWhereInput = { userId };

    if (status !== 'ALL') {
        if (status === 'PENDING') where.status = 'PENDING';
        else if (status === 'CONFIRMED') where.status = { in: ['COMPLETED', 'CONFIRMED', 'PAID'] };
        else if (status === 'FAILED') where.status = { in: ['FAILED', 'REJECTED'] };
        // Se quiser filtrar só vendas no futuro:
        // if (status === 'SALES') where.type = 'SALE';
    }

    // Busca total para paginação
    const totalItems = await this.prisma.transaction.count({ where });

    // Busca dados com detalhes
    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
          id: true,
          type: true,           // SALE, DEPOSIT, WITHDRAWAL
          amount: true,         // Valor em centavos
          status: true,
          description: true,    // "Venda: Pau de Cavalo"
          createdAt: true,
          customerName: true,   // Nome do cliente
          customerEmail: true,  // Email do cliente
          product: {            // Dados do produto (se houver)
              select: { name: true }
          }
      }
    });

    // Mapeia para o formato que o Front espera
    const mappedTransactions = transactions.map(t => ({
        id: t.id,
        type: t.type,
        amountInCents: t.amount, // O front usa amountInCents
        status: t.status,
        createdAt: t.createdAt,
        description: t.description || t.product?.name || (t.type === 'SALE' ? 'Venda de Produto' : 'Transação'),
        customerName: t.customerName,
        customerEmail: t.customerEmail
    }));
    
    return {
      transactions: mappedTransactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        limit,
      },
    };
  }

  // ===========================================================================
  // 2. CRIAR SAQUE (Atualizado para gravar na Transaction também)
  // ===========================================================================
  async createWithdrawal(userId: string, dto: WithdrawalDto) {
    const amountInCents = Math.round(dto.amount * 100);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      if (user.balance < amountInCents) throw new BadRequestException('Saldo insuficiente.');

      const externalId = uuidv4();

      // A. Cria Registro de Saque Específico
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

      // C. ✅ CRIA REGISTRO NO EXTRATO UNIFICADO (Para aparecer no histórico)
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

      // D. Chama Gateway
      try {
        const keyTypeForKeyclub = dto.keyType === 'RANDOM' ? 'EVP' : dto.keyType;
        await this.keyclubService.createWithdrawal({
          amount: dto.amount,
          externalId: withdrawal.externalId,
          pixKey: dto.pixKey,
          pixKeyType: keyTypeForKeyclub,
        });
      } catch (error) {
        this.logger.error(`Falha KeyClub Saque ${withdrawal.id}`, error);
        throw new BadRequestException('Erro ao processar saque no gateway.');
      }

      return withdrawal;
    });
  }

  // ===========================================================================
  // 3. PIX RÁPIDO (Atualizado para gravar na Transaction também)
  // ===========================================================================
  async createQuickPix(userId: string, merchantId: string, dto: QuickPixDto) {
    const amountInCents = Math.round(dto.amount * 100);
    const externalId = uuidv4();

    // A. Cria Depósito (Para Webhook achar)
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
        externalId, // ID que vai pra Keyclub
        webhookToken: uuidv4(),
      },
    });

    // B. ✅ CRIA REGISTRO NO EXTRATO (Para aparecer no Dashboard como Depósito)
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