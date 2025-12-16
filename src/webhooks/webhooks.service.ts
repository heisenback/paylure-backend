// src/webhooks/webhooks.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';
// ✅ IMPORTANTE: Importando os tipos do banco de dados
import { User, Product } from '@prisma/client';

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
    
    const metadata = payload.metadata || {};
    const affiliateId = metadata.ref || metadata.affiliateId || metadata.promoterId;

    if (!transactionId) throw new NotFoundException('transaction_id required');

    // 2. Busca Depósito
    let deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(transactionId) },
      include: { 
        paymentLink: { include: { product: true } } 
      }
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

    // 3. Verifica Idempotência
    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      return { message: 'Already processed' };
    }

    // 4. Processa Aprovação
    const approvedStatuses = ['PAID', 'COMPLETED', 'APPROVED', 'SUCCEEDED', 'CONFIRMED'];
    
    if (approvedStatuses.includes(status)) {
      const amountNumber = Number(rawAmount); 
      const amountInCents = Math.round(amountNumber * 100);
      const totalNetAmount = amountInCents; 

      const existingTransaction = await this.prisma.transaction.findFirst({
         where: { 
             OR: [
                 { id: deposit.id }, 
                 { externalId: deposit.externalId },
                 { referenceId: deposit.externalId }
             ]
         }
      });

      // ✅ CORREÇÃO 1: Tipagem explícita aqui para evitar erro TS2322
      let product: Product | null | undefined = deposit.paymentLink?.product;
      
      if (!product && existingTransaction?.productId) {
          product = await this.prisma.product.findUnique({ where: { id: existingTransaction.productId } });
      }

      const isProductSale = !!product;
      
      this.logger.log(`💰 Processando venda. Valor Total: R$ ${amountInCents/100}`);

      // --- CÁLCULO DE COMISSÃO DE AFILIADO ---
      let producerShare = totalNetAmount;
      let affiliateShare = 0;
      
      // ✅ CORREÇÃO 2: Inicializando explicitamente como User ou null
      let affiliateUser: User | null = null;

      if (isProductSale && affiliateId && product?.isAffiliationEnabled) {
          affiliateUser = await this.prisma.user.findUnique({ where: { id: affiliateId } });
          
          if (affiliateUser) {
              const commissionRate = product.commissionPercent || 0; 
              if (commissionRate > 0) {
                  affiliateShare = Math.round(totalNetAmount * (commissionRate / 100));
                  producerShare = totalNetAmount - affiliateShare;
                  
                  this.logger.log(`🤝 Split: Produtor: R$${producerShare/100} | Afiliado: R$${affiliateShare/100}`);
              }
          } else {
            this.logger.warn(`⚠️ Afiliado ID ${affiliateId} não encontrado no banco.`);
          }
      }

      // Descrição base
      const description = isProductSale 
          ? (existingTransaction?.description || `Venda: ${product?.name}`) 
          : 'Depósito via PIX';

      // --- TRANSAÇÃO ATÔMICA (DB) ---
      await this.prisma.$transaction(async (tx) => {
        // A. Atualiza Depósito
        await tx.deposit.update({
          where: { id: deposit!.id },
          data: { 
            status: 'CONFIRMED',
            amountInCents: amountInCents,
            netAmountInCents: totalNetAmount 
          },
        });

        // B. CREDITA O PRODUTOR
        await tx.user.update({
          where: { id: deposit!.userId },
          data: { balance: { increment: producerShare } },
        });

        // C. Atualiza ou Cria Transação no Extrato do PRODUTOR
        if (existingTransaction) {
            await tx.transaction.update({
                where: { id: existingTransaction.id },
                data: {
                    status: 'COMPLETED',
                    amount: producerShare,
                    metadata: payload as any
                }
            });
        } else {
            await tx.transaction.create({
                data: {
                    userId: deposit!.userId,
                    productId: product?.id,
                    type: isProductSale ? 'SALE' : 'DEPOSIT',      
                    amount: producerShare, 
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

        // D. CREDITA O AFILIADO
        // O TS agora sabe que affiliateUser é User, então .id funciona
        if (affiliateShare > 0 && affiliateUser) {
            await tx.user.update({
                where: { id: affiliateUser.id },
                data: { balance: { increment: affiliateShare } }
            });

            await tx.transaction.create({
                data: {
                    userId: affiliateUser.id,
                    productId: product?.id,
                    type: 'COMMISSION',
                    amount: affiliateShare,
                    status: 'COMPLETED',
                    referenceId: deposit!.externalId,
                    description: `Comissão: ${product?.name}`,
                    paymentMethod: 'PIX',
                    customerName: deposit!.payerName, 
                    metadata: { ...payload, role: 'affiliate' } as any,
                }
            });
        }
      });

      // 5. Notifica Frontend via Socket
      try {
        if (this.paymentGateway) {
            const freshProducer = await this.prisma.user.findUnique({where:{id:deposit.userId}});
            this.paymentGateway.emitToUser(deposit.userId, 'balance_updated', { 
                balance: freshProducer?.balance || 0 
            });
            this.paymentGateway.emitToUser(deposit.userId, 'sale_approved', { 
                amount: producerShare,
                productName: description 
            });

            if (affiliateShare > 0 && affiliateUser) {
                const freshAffiliate = await this.prisma.user.findUnique({where:{id:affiliateUser.id}});
                this.paymentGateway.emitToUser(affiliateUser.id, 'balance_updated', {
                    balance: freshAffiliate?.balance || 0
                });
                this.paymentGateway.emitToUser(affiliateUser.id, 'commission_received', {
                    amount: affiliateShare,
                    productName: product?.name
                });
            }
        }
      } catch (e) { this.logger.warn('Socket error'); }

      return { message: 'Confirmed successfully with split' };
    }

    return { message: `Status ignored: ${status}` };
  }
}