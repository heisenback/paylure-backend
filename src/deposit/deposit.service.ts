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
    // 1. âœ… CORREÃ‡ÃƒO NO LOG: Divide por 100 para mostrar o valor correto (R$ 2.00)
    const amountInBRL = dto.amount / 100;
    this.logger.log(`[DepositService] Iniciando depÃ³sito de R$${amountInBRL.toFixed(2)} para ${dto.payerName}`);

    try {
      const result = await this.keyclub.createDeposit({
        // 2. âœ… CORREÃ‡ÃƒO CRÃTICA: Envia o valor em REAIS (BRL) para a Keyclub
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

      const qr = result?.qrCodeResponse || result;
      const response = {
        message: result?.message || 'Deposit created successfully.',
        transactionId: qr?.transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        // MantÃ©m o amount da resposta KeyClub ou usa o amount original (em Centavos) do DTO
        amount: qr?.amount ? qr.amount * 100 : dto.amount,
      };

      this.logger.log(`[DepositService] âœ… DepÃ³sito criado. TX=${response.transactionId} Status=${response.status}`);
      return response;
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depÃ³sito.';
      if (msg.includes('Access token') || msg.includes('token')) {
        this.logger.error('[DepositService] âŒ Token KeyClub ausente ou invÃ¡lido.');
        throw new Error('Falha de autenticaÃ§Ã£o com KeyClub. Verifique o Bearer token.');
      }
      if (msg.toLowerCase().includes('cloudflare')) {
        this.logger.error('[DepositService] âŒ Bloqueado pelo Cloudflare (provÃ¡vel no login).');
        throw new Error('Chamada bloqueada pelo WAF da KeyClub. Use KEY_CLUB_ACCESS_TOKEN ou solicite liberaÃ§Ã£o.');
      }
      this.logger.error(`[DepositService] âŒ Erro inesperado: ${msg}`);
      throw new Error(`Erro ao criar depÃ³sito: ${msg}`);
    }
  }

  async createDeposit(userId: string | number, dto: CreateDepositDto) {
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    return this.create(dto);
  }
}