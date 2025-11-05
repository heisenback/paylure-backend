// src/keyclub/keyclub.controller.ts
import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  Logger,
  Param,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from 'src/webhooks/webhooks.service';

// Rota base: /api/keyclub
@Controller('keyclub')
export class KeyclubController {
  private readonly logger = new Logger(KeyclubController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Rota de Callback KeyClub para Depósitos e Saques.
   * POST /api/keyclub/callback/:webhookToken
   * 
   * A KeyClub envia webhooks para esta rota quando:
   * - Um depósito (PIX) é pago/cancelado/falha
   * - Um saque é completado/falha
   */
  @Post('callback/:webhookToken')
  @HttpCode(HttpStatus.OK)
  async handleKeyClubCallback(
    @Param('webhookToken') webhookToken: string,
    @Headers('x-keyclub-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody;
    const payload = req.body;

    // 1. Validação básica
    if (!rawBody || !signature || !webhookToken) {
      this.logger.error('Webhook inválido: corpo, token ou assinatura ausente.');
      throw new BadRequestException('Webhook inválido: corpo, token ou assinatura ausente.');
    }

    // 2. Validação da Assinatura HMAC
    const isValid = this.webhooksService.validateSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn(`Assinatura do webhook inválida para o token: ${webhookToken}`);
      throw new ForbiddenException('Assinatura do webhook inválida.');
    }

    this.logger.log(`Assinatura válida para o token: ${webhookToken}. Processando...`);

    // 3. Processamento do Evento baseado no tipo
    const webhookType = payload.type;

    if (webhookType === 'Deposit') {
      return this.webhooksService.handleKeyClubDeposit(webhookToken, payload);
    } else if (webhookType === 'Withdrawal') {
      return this.webhooksService.handleKeyClubWithdrawal(webhookToken, payload);
    }

    // Tipo desconhecido (para debug)
    this.logger.warn(`Tipo de webhook desconhecido: ${webhookType}`);
    return { success: true, message: `Webhook tipo ${webhookType} recebido com sucesso.` };
  }
}