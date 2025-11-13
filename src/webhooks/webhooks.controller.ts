// src/webhooks/webhooks.controller.ts
import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  Headers,
  UnauthorizedException,
  BadRequestException,
  RawBodyRequest,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { Request } from 'express';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Este é o endpoint que a Keyclub vai chamar quando um DEPÓSITO for pago.
   * A URL que você deve configurar na Keyclub (clientCallbackUrl) deve ser:
   * https://api.paylure.com/webhooks/keyclub/deposit/SEU_TOKEN_UNICO
   */
  @Post('keyclub/deposit/:token')
  async handleKeyClubDeposit(
    @Param('token') token: string,
    @Headers('x-keyclub-signature') signature: string, // <-- Verifique se este é o nome real do header na Keyclub!
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ) {
    this.logger.log(`Recebido webhook de DEPÓSITO para token: ${token}`);

    // 1. Verificar se o rawBody está disponível
    if (!req.rawBody) {
      throw new BadRequestException(
        'Raw body não disponível. Verifique a configuração do main.ts (rawBody: true).',
      );
    }

    // 2. Verificar se a assinatura veio
    if (!signature) {
      this.logger.warn(`Webhook de ${token} veio sem assinatura.`);
      throw new UnauthorizedException('Assinatura do webhook ausente.');
    }

    // 3. Validar a assinatura
    const isValid = this.webhooksService.validateSignature(req.rawBody, signature);
    if (!isValid) {
      this.logger.warn(`Assinatura inválida para token: ${token}`);
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }

    // 4. Se tudo estiver OK, processar o pagamento
    this.logger.log(`Assinatura válida. Processando depósito...`);
    return this.webhooksService.handleKeyClubDeposit(token, payload);
  }

  /**
   * Este é o endpoint que a Keyclub vai chamar quando um SAQUE for processado.
   * A URL (clientCallbackUrl) deve ser:
   * https://api.paylure.com/webhooks/keyclub/withdrawal/SEU_TOKEN_UNICO
   */
  @Post('keyclub/withdrawal/:token')
  async handleKeyClubWithdrawal(
    @Param('token') token: string,
    @Headers('x-keyclub-signature') signature: string, // <-- Verifique se este é o nome real do header na Keyclub!
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ) {
    this.logger.log(`Recebido webhook de SAQUE para token: ${token}`);

    if (!req.rawBody) {
      throw new BadRequestException(
        'Raw body não disponível. Verifique a configuração do main.ts (rawBody: true).',
      );
    }

    if (!signature) {
      throw new UnauthorizedException('Assinatura do webhook ausente.');
    }

    // 1. Validar a assinatura
    const isValid = this.webhooksService.validateSignature(req.rawBody, signature);
    if (!isValid) {
      this.logger.warn(`Assinatura de saque inválida para token: ${token}`);
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }

    // 2. Processar o saque
    this.logger.log(`Assinatura válida. Processando saque...`);
    return this.webhooksService.handleKeyClubWithdrawal(token, payload);
  }
}