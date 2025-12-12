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
    this.logger.log(`🔥 [Webhook] Payload: ${JSON.stringify(payload)}`);

    // 1. Extração de Dados
    const transactionId = payload.transaction_id || payload.id || payload.transactionId || payload.external_id;
    const rawStatus = payload.status || payload.payment_status || '';
    const rawAmount = payload.amount || payload.value || 0;
    const status = String(rawStatus).toUpperCase();

    if (!transactionId) throw new NotFoundException('transaction_id required');

    // 2. Busca Depósito (Tentativa 1: External ID, Tentativa 2: Internal ID)
    let deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(transactionId) },
      include: { paymentLink: { include: { product: true } } }
    });

    if (!deposit) {
      deposit = await this.prisma.deposit.findFirst({
        where: { id: String(transactionId) },
        include: { paymentLink: { include: { product: true } } }
      });
    }

    if (!deposit) {
        this.logger.error(`❌ Transação não encontrada no DB: ${transactionId}`);
        throw new NotFoundException(`Transação não encontrada: ${transactionId}`);
    }

    // 3. Verifica Idempotência (Já foi pago?)
    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      return { message: 'Already processed' };
    }

    // 4. Processa Aprovação
    const approvedStatuses = ['PAID', 'COMPLETED', 'APPROVED', 'SUCCEEDED', 'CONFIRMED'];
    
    if (approvedStatuses.includes(status)) {
      const amountNumber = Number(rawAmount); 
      const amountInCents = Math.round(amountNumber * 100);
      
      // REGRA: Taxa Zero na entrada (cobra no saque)
      const netAmount = amountInCents; 

      // Verifica se já existe a Transação no Extrato (criada pelo Checkout)
      const existingTransaction = await this.prisma.transaction.findFirst({
         where: { 
             OR: [
                 { id: deposit.id }, 
                 { externalId: deposit.externalId },
                 { referenceId: deposit.externalId }
             ]
         }
      });

      // Define Tipo e Descrição
      const isProductSale = existingTransaction?.type === 'SALE' || !!deposit.paymentLinkId;
      const operationType = isProductSale ? 'SALE' : 'DEPOSIT';
      const description = isProductSale 
          ? (existingTransaction?.description || `Venda Aprovada`) 
          : 'Depósito via PIX';

      this.logger.log(`💰 Aprovando ${operationType}: R$ ${amountInCents/100}`);

      // --- TRANSAÇÃO ATÔMICA ---
      await this.prisma.$transaction(async (tx) => {
        // A. Atualiza Depósito
        await tx.deposit.update({
          where: { id: deposit!.id },
          data: { 
            status: 'CONFIRMED',
            amountInCents: amountInCents,
            netAmountInCents: netAmount 
          },
        });

        // B. Atualiza Saldo do Usuário
        const updatedUser = await tx.user.update({
          where: { id: deposit!.userId },
          data: { balance: { increment: netAmount } },
        });

        // C. Atualiza ou Cria Transação no Extrato
        if (existingTransaction) {
            // Se já existe (Checkout criou), ATUALIZA STATUS
            await tx.transaction.update({
                where: { id: existingTransaction.id },
                data: {
                    status: 'COMPLETED',
                    amount: netAmount,
                    metadata: payload as any
                }
            });
        } else {
            // Se não existe (Depósito direto), CRIA NOVA
            await tx.transaction.create({
                data: {
                    userId: deposit!.userId,
                    productId: deposit!.paymentLink?.productId,
                    type: operationType,      
                    amount: netAmount, 
                    status: 'COMPLETED',   
                    referenceId: deposit!.externalId,
                    description: description,
                    paymentMethod: 'PIX',
                    customerName: deposit!.payerName,
                    customerEmail: deposit!.payerEmail,
                    customerDoc: deposit!.payerDocument,
                    metadata: payload as any,
                },
            });
        }
      });

      // 5. Notifica Frontend via Socket
      try {
        if (this.paymentGateway) {
            // Pega saldo atualizado
            const freshUser = await this.prisma.user.findUnique({where:{id:deposit.userId}});
            
            this.paymentGateway.emitToUser(deposit.userId, 'balance_updated', { 
                balance: freshUser?.balance || 0 
            });
            
            this.paymentGateway.emitToUser(deposit.userId, isProductSale ? 'sale_approved' : 'deposit_confirmed', { 
                amount: amountInCents,
                productName: description 
            });
        }
      } catch (e) { this.logger.warn('Socket error'); }

      return { message: 'Confirmed successfully' };
    }

    return { message: `Status ignored: ${status}` };
  }
}