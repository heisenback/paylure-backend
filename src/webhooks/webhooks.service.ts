// src/webhooks/webhooks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async handleXflowWebhook(payload: any) {
    this.logger.log(`🌊 Recebido Webhook XFlow: ${JSON.stringify(payload)}`);

    const transactionId = payload.transaction_id || payload.external_id;
    const status = String(payload.status).toUpperCase();

    if (status === 'COMPLETED') {
      // Busca o depósito no banco
      const deposit = await this.prisma.deposit.findUnique({
        where: { externalId: String(transactionId) },
      });

      if (deposit && deposit.status !== 'COMPLETED') {
        // Atualiza status e adiciona saldo ao usuário (Transaction segura)
        await this.prisma.$transaction([
          this.prisma.deposit.update({
            where: { id: deposit.id },
            data: { status: 'COMPLETED', confirmedAt: new Date() },
          }),
          this.prisma.user.update({
            where: { id: deposit.userId },
            data: { balance: { increment: deposit.amountInCents } },
          }),
        ]);

        this.logger.log(`💰 Saldo Creditado: R$ ${deposit.amountInCents/100} para User: ${deposit.userId}`);

        // Notifica o frontend via Socket para o saldo subir na tela na hora
        const updatedUser = await this.prisma.user.findUnique({ where: { id: deposit.userId } });
        if (updatedUser) {
          this.paymentGateway.notifyBalanceUpdate(deposit.userId, updatedUser.balance);
        }
      }
    }

    return { received: true };
  }
}