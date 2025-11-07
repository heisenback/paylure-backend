// src/deposit/deposit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';

export type CreateDepositDto = {
  amount: number;
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
    this.logger.log(`[DepositService] Iniciando depósito de R$${dto.amount} para ${dto.payerName}`);

    try {
      const result = await this.keyclub.createDeposit({
        amount: dto.amount,
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
        amount: qr?.amount ?? dto.amount,
      };

      this.logger.log(`[DepositService] ✅ Depósito criado. TX=${response.transactionId} Status=${response.status}`);
      return response;
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depósito.';
      if (msg.includes('Access token') || msg.includes('token')) {
        this.logger.error('[DepositService] ❌ Token KeyClub ausente ou inválido.');
        throw new Error('Falha de autenticação com KeyClub. Verifique o Bearer token.');
      }
      if (msg.toLowerCase().includes('cloudflare')) {
        this.logger.error('[DepositService] ❌ Bloqueado pelo Cloudflare (provável no login).');
        throw new Error('Chamada bloqueada pelo WAF da KeyClub. Use KEY_CLUB_ACCESS_TOKEN ou solicite liberação.');
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