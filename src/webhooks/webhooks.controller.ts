// src/webhooks/webhooks.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  UnauthorizedException,
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
    this.logger.log(`📥 Recebido webhook da KeyClub: ${JSON.stringify(payload)}`);

    if (signature && req.rawBody) {
      const isValid = this.webhooksService.validateSignature(req.rawBody, signature);
      if (!isValid) {
        this.logger.warn(`⚠️ Assinatura inválida!`);
        throw new UnauthorizedException('Assinatura do webhook inválida');
      }
      this.logger.log('✅ Assinatura validada com sucesso');
    } else {
      this.logger.warn('⚠️ Webhook recebido sem assinatura');
    }

    try {
      const result = await this.webhooksService.handleKeyClubWebhook(payload);
      this.logger.log(`✅ Webhook processado com sucesso`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Erro ao processar webhook: ${error.message}`);
      throw error;
    }
  }
}