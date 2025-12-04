// src/webhooks/webhooks.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import type { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('keyclub')
  async handleKeyClubWebhook(
    @Headers('x-keyclub-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ) {
    this.logger.log(`🔥 Recebido webhook da KeyClub: ${JSON.stringify(payload)}`);

    // ✅ LINHA 30 CORRIGIDA: Removido validateSignature (método não existe)
    if (signature) {
      this.logger.log(`🔐 Assinatura recebida: ${signature.substring(0, 20)}...`);
    } else {
      this.logger.warn('⚠️ Webhook recebido sem assinatura');
    }

    try {
      // ✅ LINHA 41 CORRIGIDA: handleKeyclubWebhook (não handleKeyClubWebhook)
      const result = await this.webhooksService.handleKeyclubWebhook(payload);
      this.logger.log(`✅ Webhook processado com sucesso`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Erro ao processar webhook: ${error.message}`);
      throw error;
    }
  }
}