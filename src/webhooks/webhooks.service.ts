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
    this.logger.log(`🔥 [Webhook] Payload Recebido: ${JSON.stringify(payload)}`);

    // 1. Extração Inteligente de Dados
    const transactionId = payload.transaction_id || payload.id || payload.transactionId || payload.external_id;
    const rawStatus = payload.status || payload.payment_status || '';
    const rawAmount = payload.amount || payload.value || 0;
    const status = String(rawStatus).toUpperCase();

    if (!transactionId) {
      this.logger.error('❌ [Webhook] transaction_id não encontrado no payload.');
      throw new NotFoundException('transaction_id is required');
    }

    // 2. Busca Depósito no Banco (Com PaymentLink para saber se é venda)
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(transactionId) },
      include: { 
        paymentLink: { include: { product: true } }, 
        merchant: true 
      }
    });

    if (!deposit) {
      // Fallback: Tenta buscar pelo ID interno
      const depositByInternal = await this.prisma.deposit.findFirst({
        where: { id: String(transactionId) },
        include: { paymentLink: { include: { product: true } }, merchant: true }
      });

      if (!depositByInternal) {
        this.logger.error(`❌ [Webhook] Transação não encontrada: ${transactionId}`);
        throw new NotFoundException(`Transação não encontrada: ${transactionId}`);
      }
      Object.assign(deposit, depositByInternal);
    }

    // 3. Trava de Segurança (Idempotência)
    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      this.logger.warn(`⚠️ [Webhook] Transação ${deposit.id} já processada.`);
      return { message: 'Already processed' };
    }

    // 4. Verifica Aprovação
    const approvedStatuses = ['PAID', 'COMPLETED', 'APPROVED', 'SUCCEEDED', 'CONFIRMED'];
    
    if (approvedStatuses.includes(status)) {
      const amountNumber = Number(rawAmount); 
      const amountInCents = Math.round(amountNumber * 100);

      // === DECISÃO: É VENDA DE PRODUTO OU DEPÓSITO EM CARTEIRA? ===
      const isProductSale = !!deposit.paymentLinkId;
      const operationType = isProductSale ? 'SALE' : 'DEPOSIT';
      const description = isProductSale 
          ? `Venda: ${deposit.paymentLink?.product?.name || 'Produto'}`
          : 'Depósito via PIX';

      // =================================================================================
      // ⚠️ REGRA DE NEGÓCIO: TAXA ZERO NA ENTRADA 
      // O cliente recebe 100% do valor da venda no saldo. A taxa será cobrada no saque.
      // =================================================================================
      const feeInCents = 0; 
      const netAmount = amountInCents; // Valor Líquido = Valor Bruto

      this.logger.log(`💰 [Webhook] Processando ${operationType}: Valor Integral R$ ${amountInCents/100} (Taxa será no saque)`);

      // --- TRANSAÇÃO ATÔMICA ---
      const result = await this.prisma.$transaction(async (tx) => {
        
        // A. Atualiza o Depósito/Venda
        await tx.deposit.update({
          where: { id: deposit.id },
          data: { 
            status: 'CONFIRMED',
            amountInCents: amountInCents,
            feeInCents: feeInCents, // 0
            netAmountInCents: netAmount // Valor Cheio
          },
        });

        // B. Atualiza o Saldo do Usuário (SOMA TUDO)
        const updatedUser = await tx.user.update({
          where: { id: deposit.userId },
          data: {
            balance: { increment: netAmount },
          },
        });

        // C. Cria o Registro no Extrato
        await tx.transaction.create({
          data: {
            userId: deposit.userId,
            productId: deposit.paymentLink?.productId,
            type: operationType,      
            amount: netAmount, 
            status: 'COMPLETED',   
            referenceId: deposit.externalId,
            description: description,
            paymentMethod: 'PIX',
            customerName: deposit.payerName,
            customerEmail: deposit.payerEmail,
            customerDoc: deposit.payerDocument,
            metadata: payload as any,
          },
        });

        return { updatedUser };
      });

      this.logger.log(`✅ [SUCESSO] ${operationType} confirmada! Saldo total liberado.`);

      // 5. Notifica Frontend via Socket
      try {
        if (this.paymentGateway) {
            this.paymentGateway.emitToUser(deposit.userId, 'balance_updated', {
                balance: result.updatedUser.balance,
            });

            if (isProductSale) {
                this.paymentGateway.emitToUser(deposit.userId, 'sale_approved', {
                    productName: deposit.paymentLink?.product?.name,
                    amount: netAmount
                });
            } else {
                this.paymentGateway.emitToUser(deposit.userId, 'deposit_confirmed', {
                    depositId: deposit.id,
                    amount: amountInCents,
                    newBalance: result.updatedUser.balance,
                });
            }
        }
      } catch (err) {
          this.logger.warn(`⚠️ Erro socket: ${err}`);
      }

      return { message: 'Confirmed successfully' };
    }

    return { message: `Status ignored: ${status}` };
  }
}