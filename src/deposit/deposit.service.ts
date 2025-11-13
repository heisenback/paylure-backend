// src/deposit/deposit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';

export type CreateDepositDto = {
  amount: number; // SEMPRE EM CENTAVOS (ex: 200 = R$ 2,00)
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

  constructor(private readonly keyclub: KeyclubService) {}

  async create(dto: CreateDepositDto) {
    // ✅ CORREÇÃO: dto.amount JÁ vem em CENTAVOS do frontend
    // Converte para BRL apenas uma vez para enviar à KeyClub
    const amountInBRL = dto.amount / 100;
    
    this.logger.log(
      `[DepositService] Iniciando depósito de R$${amountInBRL.toFixed(2)} ` +
      `(${dto.amount} centavos) para ${dto.payerName}`
    );

    try {
      const result = await this.keyclub.createDeposit({
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

      const qr = result?.qrCodeResponse || result;
      const response = {
        message: result?.message || 'Deposit created successfully.',
        transactionId: qr?.transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        // ✅ Retorna SEMPRE em centavos para manter consistência
        amount: dto.amount, // Mantém o valor original em centavos
      };

      this.logger.log(
        `[DepositService] ✅ Depósito criado. ` +
        `TX=${response.transactionId} Status=${response.status} ` +
        `Valor=R$${amountInBRL.toFixed(2)}`
      );
      
      return response;
      
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depósito.';
      
      // Tratamento específico de erros
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

  async createDeposit(userId: string | number, dto: CreateDepositDto) {
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    return this.create(dto);
  }
}