// src/webhooks/webhooks.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';
import { MailService } from '../mail/mail.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGateway,
    private readonly mailService: MailService,
  ) {}

  async handleKeyclubWebhook(payload: any) {
    this.logger.log(`🔥 [Webhook] Payload recebido`);

    const transactionId =
      payload.transaction_id ||
      payload.id ||
      payload.transactionId ||
      payload.external_id;

    const rawStatus = payload.status || payload.payment_status || '';
    const status = String(rawStatus).toUpperCase();

    if (!transactionId) {
      throw new NotFoundException('transaction_id required');
    }

    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(transactionId) },
    });

    if (!deposit) {
      this.logger.error(`❌ Depósito não encontrado: ${transactionId}`);
      throw new NotFoundException('Depósito não encontrado');
    }

    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      return { message: 'Already processed' };
    }

    const approvedStatuses = ['PAID', 'COMPLETED', 'APPROVED', 'SUCCEEDED', 'CONFIRMED'];
    if (!approvedStatuses.includes(status)) {
      return { message: `Status ignored: ${status}` };
    }

    const transactions = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { externalId: deposit.externalId },
          { referenceId: deposit.id },
          { referenceId: deposit.externalId },
        ],
        status: 'PENDING',
      },
    });

    if (transactions.length === 0) {
      this.logger.warn(`⚠️ Nenhuma transação pendente para ${deposit.externalId}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.deposit.update({
        where: { id: deposit.id },
        data: { status: 'CONFIRMED' },
      });

      for (const transaction of transactions) {
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'COMPLETED' },
        });

        await tx.user.update({
          where: { id: transaction.userId },
          data: {
            balance: { increment: transaction.amount },
          },
        });
      }
    });

    const frontend =
      (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim()) ||
      'https://paylure.com.br';

    try {
      for (const transaction of transactions) {
        const freshUser = await this.prisma.user.findUnique({
          where: { id: transaction.userId },
        });

        if (!freshUser) continue;

        this.paymentGateway.emitToUser(transaction.userId, 'balance_updated', {
          balance: freshUser.balance || 0,
        });

        this.paymentGateway.emitToUser(transaction.userId, 'transaction_completed', {
          amount: transaction.amount,
          type: transaction.type,
          productId: transaction.productId,
        });

        // tenta pegar nome do produto real
        let productName = 'Seu Produto';
        if (transaction.productId) {
          const prod = await this.prisma.product.findUnique({
            where: { id: transaction.productId },
            select: { name: true },
          });
          if (prod?.name) productName = prod.name;
        }

        const accessLink = `${frontend}/login`;

        await this.mailService.sendAccessEmail(
          freshUser.email,
          productName,
          accessLink,
        );
      }
    } catch (e: any) {
      this.logger.warn(`⚠️ Erro ao processar notificações: ${e?.message || e}`);
    }

    this.logger.log(`✅ Webhook processado com sucesso`);
    return { message: 'Confirmed successfully' };
  }
}
