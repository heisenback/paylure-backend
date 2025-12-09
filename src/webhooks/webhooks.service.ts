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

  async handleKeyclubWebhook(payload: any) {
    this.logger.log(`🔥 [Webhook] Iniciando processamento... Payload: ${JSON.stringify(payload)}`);

    const {
      transaction_id: transactionId,
      status,
      amount, 
    } = payload;

    if (!transactionId) {
      throw new NotFoundException('transaction_id is required');
    }

    // 1. Busca Depósito
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: transactionId },
    });

    if (!deposit) {
      throw new NotFoundException(`Depósito não encontrado no banco: ${transactionId}`);
    }

    // 2. Trava de Segurança (Idempotência)
    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      this.logger.warn(`⚠️ Depósito ${deposit.id} já estava pago. Ignorando.`);
      return { message: 'Already processed' };
    }

    // 3. Processar Pagamento Aprovado
    if (status === 'COMPLETED' || status === 'PAID') {
      
      // --- CORREÇÃO MATEMÁTICA RÍGIDA ---
      // Converte qualquer coisa que vier para número e garante centavos corretos
      const amountNumber = Number(amount); 
      // Se vier 1.00 -> vira 100. Se vier 1 -> vira 100.
      const amountInCents = Math.round(amountNumber * 100);

      this.logger.log(`💰 Processando: Recebido ${amount} | Salvar como ${amountInCents} centavos`);

      // --- TRANSAÇÃO ATÔMICA (Tudo ou Nada) ---
      const result = await this.prisma.$transaction(async (tx) => {
        
        // A. Atualiza o Depósito
        const updatedDeposit = await tx.deposit.update({
          where: { id: deposit.id },
          data: { 
            status: 'CONFIRMED',
            amountInCents: amountInCents,
            netAmountInCents: amountInCents // Se tiver taxa, descontar aqui depois
          },
        });

        // B. Atualiza o Saldo do Usuário
        const updatedUser = await tx.user.update({
          where: { id: deposit.userId },
          data: {
            balance: { increment: amountInCents },
          },
        });

        // C. Cria o Extrato (Transaction) - AJUSTADO PRO SEU SCHEMA
        await tx.transaction.create({
          data: {
            userId: deposit.userId,
            type: 'DEPOSIT',      // Bate com seu schema
            amount: amountInCents, // Bate com seu schema (Int)
            status: 'COMPLETED',   // Bate com seu schema
            referenceId: deposit.externalId,
            description: 'Depósito via PIX',
            // metadata: payload, // Opcional: salva o payload original se quiser debugar
          },
        });

        return { updatedUser };
      });

      this.logger.log(`✅ [SUCESSO] DB Atualizado! Novo saldo: R$ ${result.updatedUser.balance / 100}`);

      // 4. Notifica Frontend (Socket)
      this.paymentGateway.emitToUser(deposit.userId, 'balance_updated', {
        balance: result.updatedUser.balance,
      });

      this.paymentGateway.emitToUser(deposit.userId, 'deposit_confirmed', {
        depositId: deposit.id,
        amount: amountInCents,
        newBalance: result.updatedUser.balance,
      });

      return { message: 'Confirmed successfully' };
    }

    return { message: `Status ignored: ${status}` };
  }
}