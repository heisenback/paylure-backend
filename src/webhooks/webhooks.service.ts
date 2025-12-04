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
      amount,
      fee,
      net_amount: netAmount,
    } = payload;

    if (!transactionId) {
      this.logger.error('❌ [Webhook] transaction_id ausente no payload');
      throw new NotFoundException('transaction_id is required');
    }

    // 1️⃣ Buscar o depósito no banco pelo externalId
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: transactionId },
      include: { user: true }, // ✅ IMPORTANTE: incluir user
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
    if (status === 'COMPLETED') {
      this.logger.log(`🎉 PAGAMENTO CONFIRMADO! Iniciando crédito...`);

      const netAmountInCents = Math.round(netAmount * 100);
      const userId = deposit.userId;

      // 4️⃣ Atualizar status do depósito
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'CONFIRMED' },
      });

      this.logger.log(`✅ Status do depósito atualizado para CONFIRMED`);

      // 5️⃣ Creditar saldo do usuário
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          balance: {
            increment: netAmountInCents,
          },
        },
      });

      this.logger.log(
        `💰 Saldo atualizado: User ${userId} | Novo saldo: R$ ${(updatedUser.balance / 100).toFixed(2)}`,
      );

      // 6️⃣ Criar registro na tabela Transaction
      await this.prisma.transaction.create({
        data: {
          userId,
          type: 'DEPOSIT',
          amount: netAmountInCents, // ✅ CORRIGIDO: usar 'amount' ao invés de 'amountInCents'
          status: 'CONFIRMED',
          referenceId: deposit.externalId,
          description: 'Depósito via PIX',
        },
      });

      this.logger.log(`📝 Transação registrada no histórico`);

      // 7️⃣ Emitir eventos via WebSocket
      this.logger.log(`📡 Enviando notificações via WebSocket para userId: ${userId}`);

      // Evento 1: Atualizar saldo
      this.paymentGateway.emitToUser(userId, 'balance_updated', {
        balance: updatedUser.balance,
      });

      // Evento 2: Confirmar depósito (🎉 CONFETES!)
      this.paymentGateway.emitToUser(userId, 'deposit_confirmed', {
        depositId: deposit.id,
        amount: netAmountInCents,
        newBalance: updatedUser.balance,
      });

      this.logger.log(`✅ Evento 'deposit_confirmed' enviado`);

      // Evento 3: Broadcast geral (opcional)
      this.paymentGateway.server.emit('deposit_updated', {
        depositId: deposit.id,
        status: 'CONFIRMED',
      });

      this.logger.log(`🎊 DEPÓSITO CONFIRMADO COM SUCESSO! 🎊`);

      return {
        message: 'Deposit confirmed and user credited',
        deposit: await this.prisma.deposit.findUnique({
          where: { id: deposit.id },
          include: { user: true },
        }),
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

      return {
        message: 'Deposit marked as failed',
        deposit,
      };
    }

    // 9️⃣ Processar RETIDO (MED - Medida Cautelar)
    if (status === 'RETIDO') {
      this.logger.warn(`🚨 [Webhook] Depósito RETIDO (MED): ${deposit.id}`);

      const refundAmount = Math.round(amount * 100);

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'RETIDO' },
      });

      // Criar registro de estorno
      await this.prisma.transaction.create({
        data: {
          userId: deposit.userId,
          type: 'REFUND',
          amount: refundAmount, // ✅ CORRIGIDO: usar 'amount' ao invés de 'amountInCents'
          status: 'COMPLETED',
          referenceId: deposit.externalId,
          description: 'Estorno - Depósito retido por medida cautelar (MED)',
        },
      });

      this.paymentGateway.emitToUser(deposit.userId, 'deposit_retained', {
        depositId: deposit.id,
        reason: 'Medida Cautelar (MED)',
      });

      this.logger.log(`📝 Registro de estorno criado para MED`);

      return {
        message: 'Deposit retained (MED)',
        deposit,
      };
    }

    // 🔟 Status desconhecido
    this.logger.warn(`⚠️ [Webhook] Status desconhecido: ${status}`);
    return {
      message: `Unknown status: ${status}`,
      deposit,
    };
  }
}