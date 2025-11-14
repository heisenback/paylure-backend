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

  /**
   * Valida a assinatura do webhook da KeyClub.
   */
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

  /**
   * Ponto de entrada principal para webhooks da KeyClub.
   * Identifica se é um depósito ou saque.
   */
  async handleKeyClubWebhook(payload: any) {
    this.logger.log(`[KeyClub Webhook] Payload recebido: ${JSON.stringify(payload)}`);

    const transactionId = payload.transaction_id || payload.transactionId || payload.externalId;
    const status = payload.status?.toUpperCase();

    if (!transactionId) {
      throw new Error('transaction_id é obrigatório no webhook');
    }

    // Tenta encontrar como um Depósito
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: transactionId },
    });

    if (deposit) {
      this.logger.log(`✅ Encontrado DEPÓSITO: ${transactionId}`);
      return this.processDepositWebhook(deposit, payload, status);
    }

    // Se não for depósito, tenta encontrar como um Saque
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

  /**
   * Processa o webhook para um DEPÓSITO (PIX Recebido).
   * É AQUI QUE ESTAVA O ERRO E FOI APLICADA A CORREÇÃO.
   */
  private async processDepositWebhook(deposit: any, payload: any, status: string) {
    const { externalId, userId } = deposit;

    // 1. Lógica de idempotência (checar se já foi processado)
    if (deposit.status === 'CONFIRMED' && (status === 'COMPLETED' || status === 'CONFIRMED')) {
      this.logger.warn(`⚠️ Depósito ${externalId} já confirmado. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    // 2. Mapear o status
    const mappedStatus = status === 'COMPLETED' ? 'CONFIRMED' : status;

    // 3. Atualizar o status do depósito PRIMEIRO
    const updatedDeposit = await this.prisma.deposit.update({
      where: { externalId },
      data: { status: mappedStatus },
    });
    this.logger.log(`✅ Depósito ${externalId} atualizado para: ${mappedStatus}`);

    // 4. Somente creditar saldo se o status for CONFIRMADO
    if (mappedStatus === 'CONFIRMED') {
      
      // =================================================================
      // 🚨 INÍCIO DA CORREÇÃO DE CÁLCULO DE SALDO 🚨
      // =================================================================
      
      let netAmountInCents: number;
      const grossAmount = payload.amount; // Ex: 100.00 (valor bruto)
      const fee = payload.fee; // Ex: -1.05 (taxa)
      const netAmountFromTypo = payload.net_amout; // Ex: 98.95 (com typo da doc)
      const netAmountCorrect = payload.net_amount; // Ex: 98.95 (campo correto)

      // Abordagem 1: Usar 'net_amout' (com typo) se existir, pois está na sua doc.
      if (netAmountFromTypo !== undefined && netAmountFromTypo !== null) {
          netAmountInCents = Math.round(netAmountFromTypo * 100);
          this.logger.log(`[Cálculo de Saldo] Usando 'net_amout' (com typo). Valor: ${netAmountFromTypo} -> Cents: ${netAmountInCents}`);
      }
      // Abordagem 2: Calcular a partir de amount e fee (Mais robusto)
      else if (grossAmount !== undefined && grossAmount !== null && fee !== undefined && fee !== null) {
          netAmountInCents = Math.round((grossAmount + fee) * 100);
          this.logger.log(`[Cálculo de Saldo] Calculado (amount + fee). Valor: ${grossAmount} + ${fee} -> Cents: ${netAmountInCents}`);
      }
      // Abordagem 3: Usar 'net_amount' (campo correto) se existir
      else if (netAmountCorrect !== undefined && netAmountCorrect !== null) {
           netAmountInCents = Math.round(netAmountCorrect * 100);
           this.logger.log(`[Cálculo de Saldo] Usando 'net_amount' (correto). Valor: ${netAmountCorrect} -> Cents: ${netAmountInCents}`);
      }
      // Abordagem 4: Fallback para o 'amount' bruto, ignorando a taxa (melhor que 0)
      else if (grossAmount !== undefined && grossAmount !== null) {
          netAmountInCents = Math.round(grossAmount * 100);
          this.logger.warn(`[Cálculo de Saldo] Webhook não enviou 'fee' nem 'net_amount'. Usando 'amount' bruto: ${netAmountInCents}`);
      }
      // Abordagem 5: Fallback final (o que causa o bug atual, mas é o último recurso)
      else {
          netAmountInCents = deposit.netAmountInCents; // Usa o valor antigo do banco
          this.logger.error(`[Cálculo de Saldo] ERRO CRÍTICO: Webhook não enviou nenhum valor! Usando valor do DB: ${netAmountInCents}`);
      }
      
      // Garante que não é NaN (Not a Number)
      if (isNaN(netAmountInCents)) {
        this.logger.error(`❌ Cálculo do saldo resultou em NaN! Payload: ${JSON.stringify(payload)}`);
        netAmountInCents = 0; // Zera para não quebrar o banco
      }
      // =================================================================
      // 🚨 FIM DA CORREÇÃO 🚨
      // =================================================================

      // 5. Atualizar o saldo do usuário com o valor líquido calculado
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: netAmountInCents } }, // Usa a variável corrigida
      });

      this.logger.log(
        `💰 Saldo creditado: User ${userId} | ` +
        `+R$${(netAmountInCents / 100).toFixed(2)} | ` + // Usa a variável corrigida
        `Novo saldo: R$${(updatedUser.balance / 100).toFixed(2)}`
      );

      // 6. Notificar o frontend (via WebSocket) que o saldo mudou
      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
      this.paymentGateway.notifyDepositConfirmed(userId, {
        externalId,
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents, // Usa a variável corrigida
      });
      this.paymentGateway.emitDepositUpdate(externalId, {
        status: 'CONFIRMED',
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents, // Usa a variável corrigida
      });
    }

    return { success: true, deposit: updatedDeposit };
  }

  /**
   * Processa o webhook para um SAQUE (PIX Enviado).
   * (Esta seção não foi alterada)
   */
  private async processWithdrawalWebhook(withdrawal: any, payload: any, status: string) {
    const { externalId, userId } = withdrawal;

    if (withdrawal.status === status) {
      this.logger.warn(`⚠️ Saque ${externalId} já está no status ${status}. Ignorando.`);
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'COMPLETED' : status;

    // Lógica para devolver saldo em caso de falha
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