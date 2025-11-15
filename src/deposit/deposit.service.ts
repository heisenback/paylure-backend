// src/deposit/service.ts
import { Injectable, Logger } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDepositDto } from './dto/create-deposit.dto'; 
import * as crypto from 'crypto'; // 1. IMPORTA O CRYPTO

// O DTO que este serviço REALMENTE espera (vem do controller)
export type CreateDepositServiceDto = {
  amount: number; // EM CENTAVOS
  payerName: string;
  payerEmail: string;
  payerDocument: string;
  externalId?: string;
  callbackUrl?: string;
  phone?: string;
};

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    private readonly keyclub: KeyclubService,
    private readonly prisma: PrismaService, 
  ) {}

  // O Controller chama este método
  async createDeposit(userId: string, dto: CreateDepositServiceDto) {
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    
    const amountInBRL = dto.amount / 100;

    this.logger.log(
      `[DepositService] Iniciando depósito de R$${amountInBRL.toFixed(2)} ` +
      `(${dto.amount} centavos) para ${dto.payerName}`
    );

    try {
      // 3. CHAMA A KEYCLUB
      const keyclubResult = await this.keyclub.createDeposit({
        amount: amountInBRL, 
        externalId: dto.externalId,
        clientCallbackUrl: dto.callbackUrl,
        payer: {
          name: dto.payerName,
          email: dto.payerEmail,
          document: dto.payerDocument,
          phone: dto.phone,
        },
      });

      const qr = keyclubResult?.qrCodeResponse || keyclubResult;
      const transactionId = qr?.transactionId;

      if (!transactionId) {
        this.logger.error('[DepositService] ❌ KeyClub não retornou um transactionId.');
        throw new Error('Falha ao obter transactionId da KeyClub.');
      }

      // 4. ✅ GERA O TOKEN ÚNICO OBRIGATÓRIO
      const uniqueToken = crypto.randomBytes(20).toString('hex');

      // 5. ✅ SALVA O DEPÓSITO "PENDENTE" NO BANCO DE DADOS
      this.logger.log(`[DepositService] Salvando depósito PENDENTE no DB: ${transactionId}`);
      
      const newDeposit = await this.prisma.deposit.create({
        data: {
          externalId: transactionId,
          amountInCents: dto.amount,
          netAmountInCents: dto.amount, // Valor líquido será atualizado pelo webhook
          status: 'PENDING',
          payerName: dto.payerName,
          payerEmail: dto.payerEmail,
          payerDocument: dto.payerDocument,
          webhookToken: uniqueToken, // ✅ CAMPO OBRIGATÓRIO ADICIONADO
          user: { connect: { id: userId } },
        },
      });
      
      this.logger.log(`[DepositService] ✅ Depósito ${newDeposit.id} salvo com externalId ${transactionId}`);

      // 6. RETORNA PARA O FRONTEND
      const response = {
        message: keyclubResult?.message || 'Deposit created successfully.',
        transactionId: transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        amount: dto.amount,
      };
      
      return response;
      
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depósito.';
      
      if (err.code === 'P2002' && err.meta?.target?.includes('webhookToken')) {
        this.logger.error(`[DepositService] ❌ Conflito de Token. Tentando novamente...`);
        throw new Error('Erro ao gerar token, tente novamente.');
      }
      
      this.logger.error(`[DepositService] ❌ Erro inesperado: ${msg}`, (err as Error).stack);
      throw new Error(`Erro ao criar depósito: ${msg}`);
    }
  }
}