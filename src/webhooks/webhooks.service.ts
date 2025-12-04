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
      amount, // Valor BRUTO (Ex: 1.50)
      fee,    // Taxa (Ex: 0.50)
      net_amount: netAmount, // Valor LÍQUIDO (Ex: 1.00)
    } = payload;

    if (!transactionId) {
      this.logger.error('❌ [Webhook] transaction_id ausente no payload');
      throw new NotFoundException('transaction_id is required');
    }

    // 1️⃣ Buscar o depósito no banco pelo externalId
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: transactionId },
      include: { user: true },
    });

    if (!deposit) {
      this.logger.error(`❌ [Webhook] Depósito não encontrado: ${transactionId}`);
      throw new NotFoundException(`Deposit with externalId ${transactionId} not found`);
    }

    this.logger.log(`✅ Depósito encontrado: ${deposit.id} | User: ${deposit.userId}`);

    // 2️⃣ Verificar se já foi processado
    if (deposit.status === 'CONFIRMED') {
      this.logger.warn(`⚠️ [Webhook] Depósito já confirmado anteriormente: ${deposit.id}`);
      return {
        message: 'Deposit already confirmed',
        deposit,
      };
    }

    // 3️⃣ Processar conforme o status
    if (status === 'COMPLETED' || status === 'PAID') {
      this.logger.log(`🎉 PAGAMENTO CONFIRMADO! Iniciando crédito...`);

      // 🔥 CORREÇÃO PRINCIPAL: Usar o valor BRUTO (amount) ao invés do líquido
      // O Number() garante que converta string "1.50" para número 1.50
      const amountInCents = Math.round(Number(amount) * 100); 
      
      const userId = deposit.userId;

      this.logger.log(`💰 Valor do Depósito (Lead): R$ ${Number(amount).toFixed(2)} (${amountInCents} centavos)`);

      // 4️⃣ Atualizar status do depósito
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { 
          status: 'CONFIRMED',
          amountInCents: amountInCents, // Garante que salva o valor cheio
          netAmountInCents: amountInCents // Atualiza o líquido para ser igual ao bruto (absorvendo a taxa)
        },
      });

      this.logger.log(`✅ Status do depósito atualizado para CONFIRMED`);

      // 5️⃣ Creditar saldo do usuário (Valor CHEIO)
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          balance: {
            increment: amountInCents, // Antes estava netAmountInCents
          },
        },
      });

      this.logger.log(
        `💰 Saldo atualizado: User ${userId} | Novo saldo: R$ ${(updatedUser.balance / 100).toFixed(2)}`,
      );

      // 6️⃣ Criar registro na tabela Transaction
      // Verificamos se a tabela Transaction existe no prisma antes de tentar criar
      try {
        await this.prisma.transaction.create({
            data: {
            userId,
            type: 'DEPOSIT',
            amount: amountInCents, // Valor cheio no histórico
            status: 'CONFIRMED',
            referenceId: deposit.externalId,
            description: 'Depósito via PIX',
            },
        });
        this.logger.log(`📝 Transação registrada no histórico`);
      } catch (e) {
         this.logger.warn(`⚠️ Não foi possível criar histórico (Tabela Transaction pode não existir ou erro de schema): ${e.message}`);
      }

      // 7️⃣ Emitir eventos via WebSocket
      this.logger.log(`📡 Enviando notificações via WebSocket para userId: ${userId}`);

      // Evento 1: Atualizar saldo (Atualiza o número no topo da tela)
      this.paymentGateway.emitToUser(userId, 'balance_updated', {
        balance: updatedUser.balance,
      });

      // Evento 2: Confirmar depósito (Avisa a tela de depósito para fechar o QR Code)
      this.paymentGateway.emitToUser(userId, 'deposit_confirmed', {
        depositId: deposit.id,
        amount: amountInCents,
        newBalance: updatedUser.balance,
      });

      this.logger.log(`✅ Evento 'deposit_confirmed' enviado com saldo: ${updatedUser.balance}`);

      return {
        message: 'Deposit confirmed and user credited',
        depositId: deposit.id,
        creditedAmount: amountInCents
      };
    }

    // 8️⃣ Processar FAILED
    if (status === 'FAILED') {
      this.logger.warn(`⚠️ [Webhook] Depósito FALHOU: ${deposit.id}`);

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'FAILED' },
      });

      this.paymentGateway.emitToUser(deposit.userId, 'deposit_failed', {
        depositId: deposit.id,
      });

      return { message: 'Deposit marked as failed' };
    }

    // 9️⃣ Processar RETIDO (MED)
    if (status === 'RETIDO') {
      this.logger.warn(`🚨 [Webhook] Depósito RETIDO (MED): ${deposit.id}`);

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'RETIDO' },
      });

      this.paymentGateway.emitToUser(deposit.userId, 'deposit_retained', {
        depositId: deposit.id,
        reason: 'Medida Cautelar (MED)',
      });

      return { message: 'Deposit retained (MED)' };
    }

    // 🔟 Status desconhecido
    this.logger.warn(`⚠️ [Webhook] Status desconhecido: ${status}`);
    return { message: `Unknown status: ${status}` };
  }
}