// src/webhooks/webhooks.controller.ts
import { Controller, Post, Body, Req, Headers, Logger } from '@nestjs/common';
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
    return await this.webhooksService.handleKeyclubWebhook(payload);
  }

  // ✅ NOVA ROTA ADICIONADA PARA A XFLOW
  @Post('xflow')
  async handleXflowWebhook(@Body() payload: any) {
    this.logger.log(`🌊 Recebido webhook da XFlow: ${JSON.stringify(payload)}`);
    return await this.webhooksService.handleXflowWebhook(payload);
  }
}