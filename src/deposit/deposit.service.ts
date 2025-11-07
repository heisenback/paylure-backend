// src/deposit/deposit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';

export type CreateDepositDto = {
  amount: number;
  payerName: string;
  payerEmail: string;
  payerDocument: string; // CPF/CNPJ
  externalId?: string;
  callbackUrl?: string;
  phone?: string;
};

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(private readonly keyclub: KeyclubService) {}

  /**
   * Wrapper para manter compatibilidade com public-api.controller.ts
   * que chama: this.depositService.createDeposit(user.id, dto)
   */
  async createDeposit(_userId: string | number, dto: CreateDepositDto) {
    // se você quiser auditar por usuário, use _userId aqui (logs, persistência etc.)
    return this.create(dto);
  }

  /**
   * Método padrão usado internamente e por novos controllers.
   */
  async create(dto: CreateDepositDto) {
    this.logger.log(`[DepositService] Criando depósito amount=${dto.amount} externalId=${dto.externalId || 'auto'}`);

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

      // A doc retorna 201 { message, qrCodeResponse: {...} }
      const qr = result?.qrCodeResponse || result?.data || result;
      const response = {
        message: result?.message || 'Deposit created successfully.',
        transactionId: qr?.transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        amount: qr?.amount ?? dto.amount,
      };

      this.logger.log(`[DepositService] ✅ Depósito criado (tx=${response.transactionId}) status=${response.status}`);
      return response;
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depósito.';
      if (msg.includes('Access token is missing or invalid')) {
        this.logger.error('[DepositService] ❌ Token KeyClub inválido/ausente.');
        throw new Error('Falha de autenticação com o gateway. Verifique o token (KeyClub).');
      }
      if (msg.toLowerCase().includes('cloudflare')) {
        this.logger.error('[DepositService] ❌ Chamada barrada pelo Cloudflare (KeyClub).');
        throw new Error('Gateway temporariamente indisponível (proteção WAF). Tente novamente.');
      }
      this.logger.error(`[DepositService] ❌ Erro inesperado: ${msg}`);
      throw new Error(`Erro ao criar depósito: ${msg}`);
    }
  }
}
