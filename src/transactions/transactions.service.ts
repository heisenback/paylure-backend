// src/transactions/transactions.service.ts
import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { v4 as uuidv4 } from 'uuid';
import { QuickPixDto } from './dto/quick-pix.dto';
import { Deposit, Withdrawal } from '@prisma/client'; // Importa modelos

// --- Tipos de Saque (Usado pelo Controller) ---
export type WithdrawalDto = {
  amount: number; // Valor em BRL (ex: 10.00)
  pixKey: string;
  keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  description?: string;
};

// --- Tipo Unificado para Histórico (Vendas) ---
export type UnifiedTransaction = {
    id: string;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number; // EM REAIS
    status: string;
    date: Date;
};
// ----------------------------------------------

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  // ----------------------------------------------------
  // ITEM 8: FUNÇÃO AUXILIAR PARA CONSULTAR STATUS
  // ----------------------------------------------------
  /**
   * Busca um depósito por ID, verificando se pertence ao Merchant/User.
   */
  async findDepositById(depositId: string, userId: string) {
      return this.prisma.deposit.findFirst({
          where: {
              id: depositId,
              userId: userId, 
          },
      });
  }

  // ----------------------------------------------------
  // FUNÇÃO DE CRIAÇÃO DE SAQUE
  // ----------------------------------------------------
  async createWithdrawal(userId: string, dto: WithdrawalDto) {
    const amountInCents = Math.round(dto.amount * 100);

    return this.prisma.$transaction(async (tx) => {
      // 1. Verificar Saldo
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }
      
      if (user.balance < amountInCents) {
        throw new BadRequestException('Saldo insuficiente para o saque.');
      }

      // 2. Criar a Withdrawal (Saque) no banco de dados com status PENDING
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId: userId,
          amount: amountInCents,
          status: 'PENDING',
          pixKey: dto.pixKey,
          keyType: dto.keyType,
          description: dto.description,
          externalId: uuidv4(), // ID único para o KeyClub
        },
      });

      // 3. Debitar o saldo do usuário IMEDIATAMENTE
      await tx.user.update({
        where: { id: userId },
        data: {
          balance: {
            decrement: amountInCents,
          },
        },
      });

      // 4. Integrar com KeyClub
      try {
        await this.keyclubService.createWithdrawal({
          amount: dto.amount, // Keyclub espera EM REAIS
          externalId: withdrawal.externalId,
          pix_key: dto.pixKey,
          key_type: dto.keyType,
          description: dto.description || 'Saque Paylure',
          clientCallbackUrl: `${process.env.API_URL}/keyclub/withdrawal-callback`, 
        });

      } catch (error) {
        // Se a chamada ao KeyClub falhar, precisamos reverter o saldo
        this.logger.error(`Falha no KeyClub para Saque ${withdrawal.id}. Estornando saldo.`, error);

        await tx.user.update({
          where: { id: userId },
          data: {
            balance: {
              increment: amountInCents, // Estorna o valor
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

  // ----------------------------------------------------
  // FUNÇÃO DE HISTÓRICO (AGREGADA)
  // ----------------------------------------------------
  async getHistory(userId: string): Promise<UnifiedTransaction[]> {
    // Busca Depósitos (créditos)
    const deposits = await this.prisma.deposit.findMany({
      where: { userId },
      select: {
        id: true,
        amountInCents: true, // 🚨 USADO amountInCents
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Busca Saques (débitos)
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { userId },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Mapeia e junta os dois tipos de transação
    const history = [
      ...deposits.map(d => ({
        id: d.id,
        type: 'DEPOSIT' as const,
        amount: d.amountInCents / 100, // 🚨 Converte para Reais
        status: d.status,
        date: d.createdAt,
      })),
      ...withdrawals.map(w => ({
        id: w.id,
        type: 'WITHDRAWAL' as const,
        amount: w.amount / 100, // Converte para Reais
        status: w.status,
        date: w.createdAt,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());
    
    return history;
  }

  // ----------------------------------------------------
  // FUNÇÃO DE QUICK PIX (COBRANÇA AVULSA)
  // ----------------------------------------------------
  async createQuickPix(userId: string, merchantId: string, dto: QuickPixDto) {
    const amountInCents = Math.round(dto.amount * 100);

    // 1. Criar o Deposit (Depósito/Cobrança) no banco de dados com status PENDING
    const deposit = await this.prisma.deposit.create({
      data: {
        amountInCents: amountInCents, // 🚨 USADO amountInCents
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

    // 2. Integrar com KeyClub para gerar o PIX
    try {
      const keyclubResponse = await this.keyclubService.createDeposit({
        amount: dto.amount, // Keyclub espera EM REAIS
        externalId: deposit.externalId,
        payer: {
          name: dto.payerName,
          email: dto.payerEmail,
          document: dto.payerDocument,
        },
        clientCallbackUrl: `${process.env.API_URL}/keyclub/callback/${deposit.webhookToken}`,
      });
      
      // 3. Retornar os dados do PIX
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