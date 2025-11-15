// src/webhooks/webhooks.service.ts (REVISADO E CORRIGIDO)
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

    // Com a Correção - Parte 1, esta busca AGORA VAI FUNCIONAR
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

    if (deposit.status === 'CONFIRMED' && (status === 'COMPLETED' || status === 'CONFIRMED')) {
      this.logger.warn(`⚠️ Depósito ${externalId} já confirmado. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'CONFIRMED' : status;

    // =================================================================
    // 🎯 CORREÇÃO: CREDITAR 100% DO VALOR DEPOSITADO (SEM DESCONTOS)
    // =================================================================
    
    let netAmountInCents: number;
    const grossAmount = parseFloat(String(payload.amount || 0)); // Ex: 100.00 (valor bruto)

    // ✅ CREDITA 100% DO VALOR (sem descontar taxa da KeyClub)
    netAmountInCents = Math.round(grossAmount * 100);
    
    this.logger.log(
      `[Cálculo de Saldo] Depositou: R$ ${grossAmount.toFixed(2)} -> ` +
      `Credita 100%: ${netAmountInCents} centavos`
    );

    // Validação de segurança
    if (isNaN(netAmountInCents) || netAmountInCents <= 0) {
      this.logger.error(`❌ Valor inválido! Payload: ${JSON.stringify(payload)}`);
      netAmountInCents = 0;
    }
    
    // =================================================================
    // 🎯 FIM DA CORREÇÃO
    // =================================================================

    // Atualiza o depósito com o status e o valor líquido correto
    const updatedDeposit = await this.prisma.deposit.update({
      where: { externalId },
      data: { 
        status: mappedStatus,
        netAmountInCents: netAmountInCents, // Salva o valor integral
        feeInCents: 0, // Não cobra taxa no depósito
      },
    });
    this.logger.log(`✅ Depósito ${externalId} atualizado para: ${mappedStatus}`);

    if (mappedStatus === 'CONFIRMED') {
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: netAmountInCents } }, // Credita 100%
      });

      this.logger.log(
        `💰 Saldo creditado: User ${userId} | ` +
        `+R$${(netAmountInCents / 100).toFixed(2)} | ` +
        `Novo saldo: R$${(updatedUser.balance / 100).toFixed(2)}`
      );

      // 6. Notificar o frontend (via WebSocket) que o saldo mudou
      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
      this.paymentGateway.notifyDepositConfirmed(userId, {
        externalId,
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents,
      });
      this.paymentGateway.emitDepositUpdate(externalId, {
        status: 'CONFIRMED',
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents,
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

    // Se o saque FALHOU, devolve o saldo + taxa para o usuário
    if (mappedStatus === 'FAILED' && withdrawal.status !== 'FAILED') {
      // Devolve o valor ORIGINAL (amount já tem a taxa descontada)
      const amountToRefund = withdrawal.amount; // Valor que foi debitado

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: amountToRefund } },
      });

      this.logger.log(
        `💰 Saldo devolvido (saque falhou): User ${userId} | ` +
        `+R$${(amountToRefund / 100).toFixed(2)} | ` +
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