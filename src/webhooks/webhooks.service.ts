// src/webhooks/webhooks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  validateSignature(rawBody: string | Buffer, signature: string): boolean {
    const secret = process.env.KEY_CLUB_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn('⚠️ KEY_CLUB_WEBHOOK_SECRET não configurado');
      return false;
    }

    try {
      const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(body);
      const expectedSignature = hmac.digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      this.logger.error(`❌ Erro ao verificar assinatura: ${error.message}`);
      return false;
    }
  }

  async handleKeyClubWebhook(payload: any) {
    this.logger.log(`[KeyClub Webhook] Payload recebido: ${JSON.stringify(payload)}`);

    const transactionId = payload.transaction_id || payload.transactionId || payload.externalId;
    const status = payload.status?.toUpperCase();

    if (!transactionId) {
      throw new Error('transaction_id é obrigatório no webhook');
    }

    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: transactionId },
    });

    if (deposit) {
      this.logger.log(`✅ Encontrado DEPÓSITO: ${transactionId}`);
      return this.processDepositWebhook(deposit, payload, status);
    }

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { externalId: transactionId },
    });

    if (withdrawal) {
      this.logger.log(`✅ Encontrado SAQUE: ${transactionId}`);
      return this.processWithdrawalWebhook(withdrawal, payload, status);
    }

    this.logger.warn(`⚠️ Transação não encontrada: ${transactionId}`);
    throw new Error(`Transação ${transactionId} não encontrada`);
  }

  private async processDepositWebhook(deposit: any, payload: any, status: string) {
    const { externalId, userId } = deposit;

    if (deposit.status === 'CONFIRMED' && status === 'COMPLETED') {
      this.logger.warn(`⚠️ Depósito ${externalId} já confirmado. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'CONFIRMED' : status;

    const updatedDeposit = await this.prisma.deposit.update({
      where: { externalId },
      data: { status: mappedStatus },
    });

    this.logger.log(`✅ Depósito ${externalId} atualizado para: ${mappedStatus}`);

    if (mappedStatus === 'CONFIRMED') {
      const netAmount = payload.net_amount 
        ? Math.round(payload.net_amount * 100) 
        : updatedDeposit.netAmountInCents;

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: netAmount } },
      });

      this.logger.log(
        `💰 Saldo creditado: User ${userId} | ` +
        `+R$${(netAmount / 100).toFixed(2)} | ` +
        `Novo saldo: R$${(updatedUser.balance / 100).toFixed(2)}`
      );

      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
      this.paymentGateway.notifyDepositConfirmed(userId, {
        externalId,
        amount: updatedDeposit.amountInCents,
        netAmount,
      });
      this.paymentGateway.emitDepositUpdate(externalId, {
        status: 'CONFIRMED',
        amount: updatedDeposit.amountInCents,
        netAmount,
      });
    }

    return { success: true, deposit: updatedDeposit };
  }

  private async processWithdrawalWebhook(withdrawal: any, payload: any, status: string) {
    const { externalId, userId } = withdrawal;

    if (withdrawal.status === status) {
      this.logger.warn(`⚠️ Saque ${externalId} já está no status ${status}. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'COMPLETED' : status;

    if (mappedStatus === 'FAILED' && withdrawal.status !== 'FAILED') {
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: withdrawal.amount } },
      });

      this.logger.log(
        `💰 Saldo devolvido (saque falhou): User ${userId} | ` +
        `+R$${(withdrawal.amount / 100).toFixed(2)} | ` +
        `Novo saldo: R$${(updatedUser.balance / 100).toFixed(2)}`
      );

      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
    }

    if (mappedStatus === 'COMPLETED') {
      this.logger.log(`✅ Saque ${externalId} completado`);
      this.paymentGateway.notifyWithdrawalProcessed(userId, {
        externalId,
        amount: withdrawal.amount,
        status: 'COMPLETED',
      });
    }

    const updatedWithdrawal = await this.prisma.withdrawal.update({
      where: { externalId },
      data: { 
        status: mappedStatus,
        failureReason: payload.failure_reason || withdrawal.failureReason,
      },
    });

    this.logger.log(`✅ Saque ${externalId} atualizado para: ${mappedStatus}`);
    this.paymentGateway.emitWithdrawalUpdate(externalId, {
      status: mappedStatus,
      amount: withdrawal.amount,
    });

    return { success: true, withdrawal: updatedWithdrawal };
  }
}