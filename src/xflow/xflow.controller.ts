import { Controller, Post, Body, Query, Logger, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { XflowService } from './xflow.service';

@Controller('api/webhooks/xflow')
export class XflowController {
  private readonly logger = new Logger(XflowController.name);

  constructor(private readonly xflowService: XflowService) {}

  /**
   * Recebe notificações de Depósitos e Saques.
   * A XFlow manda o payload no Body.
   * Nós passamos o 'eid' (External ID) via Query String na criação da transação
   * para garantir que achamos o registro no banco.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Query('eid') externalId?: string
  ) {
    // Log para auditoria (Recomendado na doc da XFlow)
    this.logger.log(`🪝 Webhook recebido (EID: ${externalId}): ${JSON.stringify(payload)}`);

    // Processa a atualização
    await this.xflowService.processWebhook(payload, externalId);

    return { received: true };
  }
}