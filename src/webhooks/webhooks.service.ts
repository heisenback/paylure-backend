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
    if (!secret) return false;

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
      return false;
    }
  }

  async handleKeyClubWebhook(payload: any) {
    this.logger.log(`[Webhook] Recebido: ${JSON.stringify(payload)}`);

    const transactionId = payload.transaction_id || payload.transactionId || payload.externalId;
    const status = payload.status?.toUpperCase();

    if (!transactionId) throw new Error('transaction_id obrigatório');

    // 1. Procura Depósito
    const deposit = await this.prisma.deposit.findUnique({ where: { externalId: transactionId } });
    if (deposit) return this.processDepositWebhook(deposit, payload, status);

    // 2. Procura Saque
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { externalId: transactionId } });
    if (withdrawal) return this.processWithdrawalWebhook(withdrawal, payload, status);

    this.logger.warn(`⚠️ Transação não encontrada: ${transactionId}`);
    throw new Error('Transação não encontrada');
  }

  private async processDepositWebhook(deposit: any, payload: any, status: string) {
    const { externalId, userId } = deposit;

    // Evita duplicidade
    if (deposit.status === 'CONFIRMED' && (status === 'COMPLETED' || status === 'CONFIRMED')) {
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'CONFIRMED' : status;
    const grossAmount = parseFloat(String(payload.amount || 0));
    const netAmountInCents = Math.round(grossAmount * 100);

    // Atualiza o Depósito
    const updatedDeposit = await this.prisma.deposit.update({
      where: { externalId },
      data: { status: mappedStatus, netAmountInCents, feeInCents: 0 },
    });

    if (mappedStatus === 'CONFIRMED') {
      // 1. Atualiza Saldo do Usuário
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: netAmountInCents } },
      });

      this.logger.log(`💰 Saldo atualizado: User ${userId} | +R$ ${(netAmountInCents/100).toFixed(2)}`);

      // 2. 🔥 CORREÇÃO: Campo correto é 'amount' e não 'amountInCents'
      await this.prisma.transaction.create({
        data: {
          userId,
          type: 'DEPOSIT',
          amount: netAmountInCents, // ✅ CORRIGIDO
          status: 'CONFIRMED',
          referenceId: externalId,
          description: 'Depósito via PIX'
        }
      });

      // 3. Notifica Frontend (WebSocket)
      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
      this.paymentGateway.notifyDepositConfirmed(userId, {
        externalId,
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents,
      });
      this.paymentGateway.emitDepositUpdate(externalId, {
        status: 'CONFIRMED',
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents
      });
    }

    return { success: true };
  }

  private async processWithdrawalWebhook(withdrawal: any, payload: any, status: string) {
    const { externalId, userId } = withdrawal;

    if (withdrawal.status === status) return { success: true };

    const mappedStatus = status === 'COMPLETED' ? 'COMPLETED' : status;

    // Se falhou, devolve o dinheiro
    if (mappedStatus === 'FAILED' && withdrawal.status !== 'FAILED') {
      const refundAmount = withdrawal.amount;
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: refundAmount } },
      });
      
      // 🔥 CORREÇÃO: Campo correto é 'amount' e não 'amountInCents'
      await this.prisma.transaction.create({
        data: {
          userId,
          type: 'DEPOSIT',
          amount: refundAmount, // ✅ CORRIGIDO
          status: 'CONFIRMED',
          referenceId: `REFUND-${externalId}`,
          description: 'Estorno de Saque'
        }
      });

      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
    }

    // Se completou, atualiza o status da transação original no extrato
    if (mappedStatus === 'COMPLETED') {
        const tx = await this.prisma.transaction.findFirst({
            where: { referenceId: externalId, type: 'WITHDRAWAL' }
        });
        if (tx) {
            await this.prisma.transaction.update({
                where: { id: tx.id },
                data: { status: 'COMPLETED' }
            });
        }
        
        this.paymentGateway.notifyWithdrawalProcessed(userId, {
            externalId,
            amount: withdrawal.amount,
            status: 'COMPLETED',
        });
    }

    await this.prisma.withdrawal.update({
      where: { externalId },
      data: { status: mappedStatus, failureReason: payload.failure_reason },
    });

    return { success: true };
  }
}