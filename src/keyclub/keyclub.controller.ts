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
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from 'src/webhooks/webhooks.service';

@Controller('keyclub')
export class KeyclubController {
  private readonly logger = new Logger(KeyclubController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-keyclub-signature') signature: string,
    @Headers('x-keyclub-token') webhookToken: string,
  ) {
    if (!signature || !webhookToken) {
      throw new BadRequestException('Webhook sem assinatura/token.');
    }

    const rawBody = (req as any).rawBody || (req.body ? JSON.stringify(req.body) : '');
    const secret = process.env.KEY_CLUB_WEBHOOK_SECRET;
    if (!secret) {
      throw new ForbiddenException('Segredo de webhook não configurado.');
    }

    const isValid = await this.webhooksService.verifyKeyClubSignature(rawBody, signature, secret);
    if (!isValid) {
      throw new ForbiddenException('Assinatura inválida.');
    }

    const payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody || '{}');
    const webhookType = payload?.type;

    if (webhookType === 'Deposit') {
      return this.webhooksService.handleKeyClubDeposit(webhookToken, payload);
    } else if (webhookType === 'Withdrawal') {
      return this.webhooksService.handleKeyClubWithdrawal(webhookToken, payload);
    }

    this.logger.warn(`Tipo de webhook desconhecido: ${webhookType}`);
    return { success: true, message: `Webhook tipo ${webhookType} recebido com sucesso.` };
  }
}
