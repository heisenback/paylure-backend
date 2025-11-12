// src/deposit/deposit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';
import { PushNotificationService } from '../push-notification/push-notification.service'; 

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

  constructor(
    private readonly keyclub: KeyclubService,
    private readonly pushNotificationService: PushNotificationService, 
  ) {}

  async create(dto: CreateDepositDto) {
    // 1. CORREÇÃO NO LOG: Divide por 100 para mostrar o valor correto (R$ 2.00)
    const amountInBRL = dto.amount / 100;
    this.logger.log(`[DepositService] Iniciando depósito de R$${amountInBRL.toFixed(2)} para ${dto.payerName}`);

    try {
      const result = await this.keyclub.createDeposit({
        // 2. CORREÇÃO CRÍTICA (já estava ok): Envia o valor em REAIS (BRL) para a Keyclub
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
        // Mantém o amount da resposta KeyClub ou usa o amount original (em Centavos) do DTO
        amount: qr?.amount ? qr.amount * 100 : dto.amount,
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
    
    const result = await this.create(dto);

    // 🔔 CORREÇÃO PUSH: Notifica que o PIX foi gerado com sucesso.
    if (result.qrcode && result.transactionId) {
      await this.pushNotificationService.notifyPixGenerated(
        String(userId), // Converte para string para a tipagem do PushService
        dto.amount, // Valor em centavos
        result.qrcode // O código PIX
      );
      this.logger.log(`🔔 Notificação de PIX Gerado enviada para ${userId}`);
    }

    return result;
  }
}