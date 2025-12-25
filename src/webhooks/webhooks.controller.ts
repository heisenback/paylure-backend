import { Controller, Post, Body, Req, Headers, Logger, Query, HttpCode, HttpStatus } from '@nestjs/common';
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
    return await this.webhooksService.handleKeyclubWebhook(payload);
  }

  @Post('xflow')
  @HttpCode(HttpStatus.OK)
  async handleXflowWebhook(
    @Body() payload: any,
    @Query('eid') eid?: string 
  ) {
    // Log para ver o que a XFlow mandou
    this.logger.log(`🌊 [Webhook XFlow] EID URL: ${eid || 'N/A'}`);
    this.logger.log(`📦 [Webhook XFlow] Payload: ${JSON.stringify(payload)}`);
    
    return await this.webhooksService.handleXflowWebhook(payload, eid);
  }
}