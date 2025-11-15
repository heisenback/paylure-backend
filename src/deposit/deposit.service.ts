// src/deposit/deposit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';
import { PrismaService } from 'src/prisma/prisma.service'; // 1. IMPORTAR O PRISMA
import { CreateDepositDto } from './dto/create-deposit.dto'; // Importa o DTO local

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
    private readonly prisma: PrismaService, // 2. INJETAR O PRISMA
  ) {}

  // O Controller chama este método
  async createDeposit(userId: string, dto: CreateDepositServiceDto) {
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    
    // Converte centavos para BRL apenas para enviar à KeyClub
    const amountInBRL = dto.amount / 100;

    this.logger.log(
      `[DepositService] Iniciando depósito de R$${amountInBRL.toFixed(2)} ` +
      `(${dto.amount} centavos) para ${dto.payerName}`
    );

    try {
      // 3. CHAMA A KEYCLUB (como antes)
      const keyclubResult = await this.keyclub.createDeposit({
        amount: amountInBRL, // Envia em BRL para a KeyClub
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

      // 4. ✅ SALVA O DEPÓSITO "PENDENTE" NO BANCO DE DADOS
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
          user: { connect: { id: userId } },
          // Adicione quaisquer outros campos obrigatórios do seu schema.prisma
          // feeInCents: 0, (se for obrigatório e não tiver default)
          // webhookToken: '...'. (se for obrigatório e não tiver default)
        },
      });
      
      this.logger.log(`[DepositService] ✅ Depósito ${newDeposit.id} salvo com externalId ${transactionId}`);

      // 5. RETORNA PARA O FRONTEND (como antes)
      const response = {
        message: keyclubResult?.message || 'Deposit created successfully.',
        transactionId: transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        amount: dto.amount, // Mantém o valor original em centavos
      };
      
      return response;
      
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depósito.';
      
      if (msg.includes('Access token') || msg.includes('token')) {
        this.logger.error('[DepositService] ❌ Token KeyClub ausente ou inválido.');
        throw new Error('Falha de autenticação com KeyClub. Verifique o Bearer token.');
      }
      
      if (msg.toLowerCase().includes('cloudflare') || msg.toLowerCase().includes('waf')) {
        this.logger.error('[DepositService] ❌ Bloqueado pelo Cloudflare/WAF da KeyClub.');
        throw new Error(
          'Chamada bloqueada pelo WAF da KeyClub. ' +
          'Use KEY_CLUB_ACCESS_TOKEN ou solicite liberação do IP.'
        );
      }
      
      this.logger.error(`[DepositService] ❌ Erro inesperado: ${msg}`);
      throw new Error(`Erro ao criar depósito: ${msg}`);
    }
  }
}