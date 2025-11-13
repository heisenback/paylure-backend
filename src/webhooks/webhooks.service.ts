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

  /**
   * Processa webhook de depósito da KeyClub
   */
  async handleDepositWebhook(payload: any) {
    this.logger.log(`[Webhook] Recebido webhook de depósito: ${JSON.stringify(payload)}`);

    const { externalId, status, amount } = payload;

    if (!externalId) {
      throw new Error('externalId é obrigatório no webhook');
    }

    // Busca o depósito
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId },
    });

    if (!deposit) {
      this.logger.warn(`[Webhook] Depósito não encontrado: ${externalId}`);
      throw new Error(`Depósito ${externalId} não encontrado`);
    }

    // Previne processamento duplicado
    if (deposit.status === 'CONFIRMED' && status === 'CONFIRMED') {
      this.logger.warn(`[Webhook] Depósito ${externalId} já foi confirmado. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    // Atualiza o status
    const updatedDeposit = await this.prisma.deposit.update({
      where: { externalId },
      data: { status },
    });

    this.logger.log(`[Webhook] Depósito ${externalId} atualizado para status: ${status}`);

    // Se confirmado, credita o saldo
    if (status === 'CONFIRMED' || status === 'PAID') {
      const netAmount = updatedDeposit.netAmountInCents;

      const updatedUser = await this.prisma.user.update({
        where: { id: deposit.userId },
        data: {
          balance: {
            increment: netAmount,
          },
        },
      });

      this.logger.log(
        `[Webhook] ✅ Saldo creditado: User ${deposit.userId} | ` +
        `+R$${(netAmount / 100).toFixed(2)} | ` +
        `Novo saldo: R$${(updatedUser.balance / 100).toFixed(2)}`
      );

      // Notifica via WebSocket
      this.paymentGateway.notifyBalanceUpdate(deposit.userId, updatedUser.balance);

      // Emite atualização do depósito
      this.paymentGateway.emitDepositUpdate(deposit.externalId, {
        status: 'CONFIRMED',
        amount: updatedDeposit.amountInCents,
        netAmount: netAmount,
      });

      // Notifica depósito confirmado
      this.paymentGateway.notifyDepositConfirmed(deposit.userId, {
        externalId: deposit.externalId,
        amount: updatedDeposit.amountInCents,
        netAmount: netAmount,
      });
    }

    return { success: true, deposit: updatedDeposit };
  }

  /**
   * Processa webhook de saque da KeyClub
   */
  async handleWithdrawalWebhook(payload: any) {
    this.logger.log(`[Webhook] Recebido webhook de saque: ${JSON.stringify(payload)}`);

    const { externalId, status, failureReason } = payload;

    if (!externalId) {
      throw new Error('externalId é obrigatório no webhook');
    }

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { externalId },
    });

    if (!withdrawal) {
      this.logger.warn(`[Webhook] Saque não encontrado: ${externalId}`);
      throw new Error(`Saque ${externalId} não encontrado`);
    }

    // Previne processamento duplicado
    if (withdrawal.status === status) {
      this.logger.warn(`[Webhook] Saque ${externalId} já está no status ${status}. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    // Se for FAILED, devolve o saldo (se ainda não devolveu)
    if (status === 'FAILED' && withdrawal.status !== 'FAILED') {
      const updatedUser = await this.prisma.user.update({
        where: { id: withdrawal.userId },
        data: {
          balance: {
            increment: withdrawal.amount,
          },
        },
      });

      this.logger.log(
        `[Webhook] 💰 Saldo devolvido (saque falhou): User ${withdrawal.userId} | ` +
        `+R$${(withdrawal.amount / 100).toFixed(2)} | ` +
        `Novo saldo: R$${(updatedUser.balance / 100).toFixed(2)}`
      );

      // Notifica via WebSocket
      this.paymentGateway.emitWithdrawalUpdate(withdrawal.externalId, {
        status: 'FAILED',
        amount: withdrawal.amount,
        failureReason,
      });

      // Notifica atualização de saldo
      this.paymentGateway.notifyBalanceUpdate(withdrawal.userId, updatedUser.balance);
    }

    // Se for COMPLETED
    if (status === 'COMPLETED') {
      this.logger.log(`[Webhook] ✅ Saque ${externalId} completado com sucesso`);

      // Notifica via WebSocket
      this.paymentGateway.emitWithdrawalUpdate(withdrawal.externalId, {
        status: 'COMPLETED',
        amount: withdrawal.amount,
      });

      // Notifica saque processado
      this.paymentGateway.notifyWithdrawalProcessed(withdrawal.userId, {
        externalId: withdrawal.externalId,
        amount: withdrawal.amount,
        status: 'COMPLETED',
      });
    }

    // Atualiza o status do saque
    const updatedWithdrawal = await this.prisma.withdrawal.update({
      where: { externalId },
      data: { 
        status,
        failureReason: failureReason || withdrawal.failureReason,
      },
    });

    this.logger.log(`[Webhook] Saque ${externalId} atualizado para status: ${status}`);

    return { success: true, withdrawal: updatedWithdrawal };
  }

  /**
   * Valida o webhook token (segurança)
   */
  validateWebhookToken(token: string, expectedToken: string): boolean {
    return token === expectedToken;
  }

  /**
   * Processa webhook genérico (para outros eventos)
   */
  async handleGenericWebhook(payload: any) {
    this.logger.log(`[Webhook] Recebido webhook genérico: ${JSON.stringify(payload)}`);
    
    // Processa outros tipos de webhook aqui
    const { type } = payload;

    switch (type) {
      case 'deposit':
        return this.handleDepositWebhook(payload);
      
      case 'withdrawal':
        return this.handleWithdrawalWebhook(payload);
      
      default:
        this.logger.warn(`[Webhook] Tipo de webhook desconhecido: ${type}`);
        return { success: false, message: 'Unknown webhook type' };
    }
  }
}