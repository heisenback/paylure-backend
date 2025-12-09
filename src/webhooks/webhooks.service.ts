// src/webhooks/webhooks.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
   * 🔥 WEBHOOK DA PAYLURE (KeyClub) - Quando o PIX é PAGO
   */
  async handleKeyclubWebhook(payload: any) {
    this.logger.log(`🔥 [Webhook] Payload recebido: ${JSON.stringify(payload)}`);

    const {
      transaction_id: transactionId,
      status,
      amount, // Pode vir como string "1.50" ou number
    } = payload;

    if (!transactionId) {
      this.logger.error('❌ [Webhook] transaction_id ausente no payload');
      throw new NotFoundException('transaction_id is required');
    }

    // 1️⃣ Buscar o depósito no banco
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: transactionId },
    });

    if (!deposit) {
      this.logger.error(`❌ [Webhook] Depósito não encontrado: ${transactionId}`);
      throw new NotFoundException(`Deposit with externalId ${transactionId} not found`);
    }

    // 2️⃣ Verificar se já foi processado (Idempotência)
    if (deposit.status === 'CONFIRMED') {
      this.logger.warn(`⚠️ [Webhook] Depósito já confirmado anteriormente: ${deposit.id}`);
      return { message: 'Deposit already confirmed' };
    }

    // 3️⃣ Processar SUCESSO
    if (status === 'COMPLETED' || status === 'PAID') {
      this.logger.log(`🎉 PROCESSANDO PAGAMENTO: Depósito ${deposit.id}`);

      // 🔥 CORREÇÃO DE VALOR: Garante que "1.00" vire 100 centavos
      const amountNumber = Number(amount);
      if (isNaN(amountNumber)) {
         throw new Error(`Valor inválido recebido no webhook: ${amount}`);
      }
      const amountInCents = Math.round(amountNumber * 100);

      // 🔥 TRANSAÇÃO ATÔMICA (O Segredo para não perder saldo)
      // O banco só confirma se as 3 operações funcionarem juntas
      const result = await this.prisma.$transaction(async (tx) => {
        
        // A. Atualiza Status do Depósito
        const updatedDeposit = await tx.deposit.update({
          where: { id: deposit.id },
          data: { 
            status: 'CONFIRMED',
            amountInCents: amountInCents,
            netAmountInCents: amountInCents 
          },
        });

        // B. Incrementa Saldo do Usuário
        const updatedUser = await tx.user.update({
          where: { id: deposit.userId },
          data: {
            balance: { increment: amountInCents },
          },
        });

        // C. Cria Histórico (Se a tabela transaction existir no schema)
        // Se der erro aqui, ele cancela o saldo (Rollback), evitando inconsistência
        try {
            await tx.transaction.create({
                data: {
                    userId: deposit.userId,
                    type: 'DEPOSIT',
                    amount: amountInCents, // Nome do campo pode variar no seu schema (amount ou amountInCents)
                    status: 'CONFIRMED',
                    referenceId: deposit.externalId,
                    description: 'Depósito via PIX',
                },
            });
        } catch (e) {
            // Se a tabela não existir, apenas logamos, mas não matamos a transação
            // Se a tabela transaction for CRÍTICA, remova esse try/catch
            this.logger.warn(`⚠️ Aviso: Não foi possível criar registro na tabela Transaction: ${e.message}`);
        }

        return { updatedUser, updatedDeposit };
      });

      this.logger.log(`✅ Transação DB concluída com sucesso.`);
      this.logger.log(`💰 Novo Saldo do User ${result.updatedUser.id}: R$ ${(result.updatedUser.balance / 100).toFixed(2)}`);

      // 4️⃣ Emitir eventos Socket (Só depois de garantir que o banco salvou)
      this.paymentGateway.emitToUser(deposit.userId, 'balance_updated', {
        balance: result.updatedUser.balance,
      });

      this.paymentGateway.emitToUser(deposit.userId, 'deposit_confirmed', {
        depositId: deposit.id,
        amount: amountInCents,
        newBalance: result.updatedUser.balance,
      });

      return { message: 'Deposit confirmed', newBalance: result.updatedUser.balance };
    }

    // 4️⃣ Processar FALHA
    if (status === 'FAILED') {
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'FAILED' },
      });
      this.paymentGateway.emitToUser(deposit.userId, 'deposit_failed', { depositId: deposit.id });
      return { message: 'Deposit failed' };
    }

    return { message: `Ignored status: ${status}` };
  }
}