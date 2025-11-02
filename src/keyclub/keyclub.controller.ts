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
// AQUI: Importação correta do serviço, supondo que o WebhooksModule exporta o WebhooksService
import { WebhooksService } from 'src/webhooks/webhooks.service'; 

// Rota final será: POST /api/keyclub/callback/:webhookToken
@Controller('keyclub') 
export class KeyclubController { 
  // CORREÇÃO: Removido o 'new' extra
  private readonly logger = new Logger(KeyclubController.name);

  // Injetamos o WebhooksService
  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Rota de Callback KeyClub para Depósitos.
   * Rota: POST /api/keyclub/callback/:webhookToken
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

    if (!rawBody || !signature || !webhookToken) {
      this.logger.error('Webhook inválido: corpo, token ou assinatura ausente.');
      throw new BadRequestException('Webhook inválido: corpo, token ou assinatura ausente.'); 
    }

    // 2. Validação da Assinatura
    const isValid = this.webhooksService.validateSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn(`Assinatura do webhook inválida para o token: ${webhookToken}`);
      throw new ForbiddenException('Assinatura do webhook inválida.'); 
    }

    this.logger.log(`Assinatura válida para o token: ${webhookToken}. Processando...`);

    // 3. Processamento do Evento
    const webhookType = payload.type;

    if (webhookType === 'Deposit') {
      return this.webhooksService.handleKeyClubDeposit(webhookToken, payload);
    } 
    
    return { success: true, message: `Webhook tipo ${webhookType} recebido com sucesso.` };
  }
}