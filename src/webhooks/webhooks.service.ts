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
      this.logger.error(`❌ Erro ao validar assinatura: ${error.message}`);
      return false;
    }
  }

  async handleKeyClubWebhook(payload: any) {
    this.logger.log(`🔥 [Webhook] Payload recebido: ${JSON.stringify(payload)}`);

    const transactionId = payload.transaction_id || payload.transactionId || payload.externalId;
    const status = payload.status?.toUpperCase();

    this.logger.log(`📝 TransactionId: ${transactionId} | Status: ${status}`);

    if (!transactionId) {
      this.logger.error('❌ transaction_id não encontrado no payload');
      throw new Error('transaction_id obrigatório');
    }

    // 1. Procura Depósito
    const deposit = await this.prisma.deposit.findUnique({ 
      where: { externalId: transactionId },
      include: { user: true }
    });
    
    if (deposit) {
      this.logger.log(`✅ Depósito encontrado: ${deposit.id} | User: ${deposit.userId}`);
      return this.processDepositWebhook(deposit, payload, status);
    }

    // 2. Procura Saque
    const withdrawal = await this.prisma.withdrawal.findUnique({ 
      where: { externalId: transactionId },
      include: { user: true }
    });
    
    if (withdrawal) {
      this.logger.log(`✅ Saque encontrado: ${withdrawal.id} | User: ${withdrawal.userId}`);
      return this.processWithdrawalWebhook(withdrawal, payload, status);
    }

    this.logger.warn(`⚠️ Transação não encontrada: ${transactionId}`);
    throw new Error('Transação não encontrada');
  }

  private async processDepositWebhook(deposit: any, payload: any, status: string) {
    const { externalId, userId } = deposit;

    this.logger.log(`🔄 Processando depósito | Status Atual: ${deposit.status} | Novo Status: ${status}`);

    // Evita duplicidade
    if (deposit.status === 'CONFIRMED' && (status === 'COMPLETED' || status === 'CONFIRMED')) {
      this.logger.log(`ℹ️ Depósito já confirmado. Ignorando webhook duplicado.`);
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'CONFIRMED' : status;
    const grossAmount = parseFloat(String(payload.amount || 0));
    const netAmountInCents = Math.round(grossAmount * 100);

    this.logger.log(`💵 Valor bruto: R$ ${grossAmount.toFixed(2)} | Centavos: ${netAmountInCents}`);

    // Atualiza o Depósito
    const updatedDeposit = await this.prisma.deposit.update({
      where: { externalId },
      data: { 
        status: mappedStatus, 
        netAmountInCents, 
        feeInCents: 0 
      },
    });

    this.logger.log(`✅ Depósito atualizado no DB | Status: ${mappedStatus}`);

    if (mappedStatus === 'CONFIRMED') {
      this.logger.log(`🎉 PAGAMENTO CONFIRMADO! Iniciando crédito...`);

      // 1. Atualiza Saldo do Usuário
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: netAmountInCents } },
      });

      this.logger.log(`💰 Saldo atualizado: User ${userId} | Novo saldo: R$ ${(updatedUser.balance/100).toFixed(2)}`);

      // 2. 🔥 CORREÇÃO CRÍTICA: Campo correto é 'amountInCents'
      await this.prisma.transaction.create({
        data: {
          userId,
          type: 'DEPOSIT',
          amountInCents: netAmountInCents, // ✅ CORRIGIDO DE 'amount' PARA 'amountInCents'
          status: 'CONFIRMED',
          referenceId: externalId,
          description: 'Depósito via PIX'
        }
      });

      this.logger.log(`📝 Transação registrada no extrato`);

      // 3. 🔥 NOTIFICAÇÕES VIA WEBSOCKET
      this.logger.log(`📡 Enviando notificações via WebSocket para userId: ${userId}`);
      
      // Notifica atualização de saldo
      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
      this.logger.log(`✅ Evento 'balance_updated' enviado`);
      
      // Notifica depósito confirmado
      this.paymentGateway.notifyDepositConfirmed(userId, {
        externalId,
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents,
        status: 'CONFIRMED'
      });
      this.logger.log(`✅ Evento 'deposit_confirmed' enviado`);
      
      // Broadcast geral (opcional)
      this.paymentGateway.emitDepositUpdate(externalId, {
        status: 'CONFIRMED',
        amount: updatedDeposit.amountInCents,
        netAmount: netAmountInCents
      });
      this.logger.log(`✅ Evento 'deposit_updated' broadcast enviado`);

      this.logger.log(`🎊 DEPÓSITO CONFIRMADO COM SUCESSO! 🎊`);
    }

    return { success: true, message: 'Webhook processed successfully' };
  }

  private async processWithdrawalWebhook(withdrawal: any, payload: any, status: string) {
    const { externalId, userId } = withdrawal;

    this.logger.log(`🔄 Processando saque | Status Atual: ${withdrawal.status} | Novo Status: ${status}`);

    if (withdrawal.status === status) {
      this.logger.log(`ℹ️ Status já atualizado. Ignorando webhook duplicado.`);
      return { success: true, message: 'Already processed' };
    }

    const mappedStatus = status === 'COMPLETED' ? 'COMPLETED' : status;

    // Se falhou, devolve o dinheiro
    if (mappedStatus === 'FAILED' && withdrawal.status !== 'FAILED') {
      this.logger.warn(`⚠️ Saque FALHOU! Revertendo valor...`);
      
      const refundAmount = withdrawal.amount;
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: refundAmount } },
      });
      
      this.logger.log(`💰 Saldo revertido: User ${userId} | +R$ ${(refundAmount/100).toFixed(2)}`);
      
      // 🔥 CORREÇÃO: Campo correto é 'amountInCents'
      await this.prisma.transaction.create({
        data: {
          userId,
          type: 'DEPOSIT',
          amountInCents: refundAmount, // ✅ CORRIGIDO DE 'amount' PARA 'amountInCents'
          status: 'CONFIRMED',
          referenceId: `REFUND-${externalId}`,
          description: 'Estorno de Saque'
        }
      });

      this.paymentGateway.notifyBalanceUpdate(userId, updatedUser.balance);
      this.logger.log(`✅ Notificação de estorno enviada`);
    }

    // Se completou com sucesso
    if (mappedStatus === 'COMPLETED') {
      this.logger.log(`✅ Saque completado com sucesso!`);
      
      const tx = await this.prisma.transaction.findFirst({
        where: { referenceId: externalId, type: 'WITHDRAWAL' }
      });
      
      if (tx) {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { status: 'COMPLETED' }
        });
        this.logger.log(`📝 Status da transação atualizado para COMPLETED`);
      }
      
      this.paymentGateway.notifyWithdrawalProcessed(userId, {
        externalId,
        amount: withdrawal.amount,
        status: 'COMPLETED',
      });
      this.logger.log(`✅ Notificação de saque processado enviada`);
    }

    // Atualiza o withdrawal
    await this.prisma.withdrawal.update({
      where: { externalId },
      data: { 
        status: mappedStatus, 
        failureReason: payload.failure_reason || null 
      },
    });

    this.logger.log(`✅ Saque atualizado no DB | Status: ${mappedStatus}`);

    return { success: true, message: 'Withdrawal webhook processed successfully' };
  }
}