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
    
    // Tenta pegar o ID do afiliado vindo dos metadados da Keyclub (se o checkout enviou)
    const metadata = payload.metadata || {};
    const affiliateId = metadata.ref || metadata.affiliateId || metadata.promoterId;

    if (!transactionId) throw new NotFoundException('transaction_id required');

    // 2. Busca Depósito (Tentativa 1: External ID, Tentativa 2: Internal ID)
    let deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(transactionId) },
      include: { 
        paymentLink: { 
          include: { 
            product: true // Importante para pegar a % de comissão
          } 
        } 
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

    // 3. Verifica Idempotência (Já foi pago?)
    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      return { message: 'Already processed' };
    }

    // 4. Processa Aprovação
    const approvedStatuses = ['PAID', 'COMPLETED', 'APPROVED', 'SUCCEEDED', 'CONFIRMED'];
    
    if (approvedStatuses.includes(status)) {
      const amountNumber = Number(rawAmount); 
      const amountInCents = Math.round(amountNumber * 100);
      
      // Valor líquido total (taxas da plataforma podem ser descontadas aqui se necessário)
      const totalNetAmount = amountInCents; 

      // Verifica se já existe a Transação no Extrato (criada pelo Checkout como PENDING)
      const existingTransaction = await this.prisma.transaction.findFirst({
         where: { 
             OR: [
                 { id: deposit.id }, 
                 { externalId: deposit.externalId },
                 { referenceId: deposit.externalId }
             ]
         }
      });

      // Define se é venda de produto ou depósito direto
      // Tenta pegar o produto via paymentLink ou busca manual se não tiver link associado
      let product = deposit.paymentLink?.product;
      
      if (!product && existingTransaction?.productId) {
          product = await this.prisma.product.findUnique({ where: { id: existingTransaction.productId } });
      }

      const isProductSale = !!product;
      
      this.logger.log(`💰 Processando venda. Valor Total: R$ ${amountInCents/100}`);

      // --- CÁLCULO DE COMISSÃO DE AFILIADO ---
      let producerShare = totalNetAmount;
      let affiliateShare = 0;
      let affiliateUser = null;

      // Se for venda de produto, tiver afiliado identificado e a afiliação estiver ativa no produto
      if (isProductSale && affiliateId && product?.isAffiliationEnabled) {
          // Busca se o afiliado existe
          affiliateUser = await this.prisma.user.findUnique({ where: { id: affiliateId } });
          
          if (affiliateUser) {
              const commissionRate = product.commissionPercent || 0; // Ex: 50.0
              if (commissionRate > 0) {
                  affiliateShare = Math.round(totalNetAmount * (commissionRate / 100));
                  producerShare = totalNetAmount - affiliateShare;
                  
                  this.logger.log(`🤝 Split de Comissão: Produtor: R$${producerShare/100} | Afiliado (${affiliateUser.name}): R$${affiliateShare/100}`);
              }
          } else {
            this.logger.warn(`⚠️ Afiliado ID ${affiliateId} não encontrado no banco.`);
          }
      }

      // Descrição base para o extrato
      const description = isProductSale 
          ? (existingTransaction?.description || `Venda: ${product?.name}`) 
          : 'Depósito via PIX';

      // --- TRANSAÇÃO ATÔMICA (DB) ---
      await this.prisma.$transaction(async (tx) => {
        // A. Atualiza Depósito para CONFIRMED
        await tx.deposit.update({
          where: { id: deposit!.id },
          data: { 
            status: 'CONFIRMED',
            amountInCents: amountInCents,
            netAmountInCents: totalNetAmount 
          },
        });

        // B. CREDITA O PRODUTOR (Com o valor já descontado a comissão)
        await tx.user.update({
          where: { id: deposit!.userId },
          data: { balance: { increment: producerShare } },
        });

        // C. Atualiza ou Cria Transação no Extrato do PRODUTOR
        if (existingTransaction) {
            // Se já existia, atualizamos o valor para a parte do produtor
            await tx.transaction.update({
                where: { id: existingTransaction.id },
                data: {
                    status: 'COMPLETED',
                    amount: producerShare, // Valor real do produtor
                    metadata: payload as any
                }
            });
        } else {
            // Se não existia, cria nova para o produtor
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

        // D. CREDITA O AFILIADO (Se houver split)
        if (affiliateShare > 0 && affiliateUser) {
            // Sobe saldo do afiliado
            await tx.user.update({
                where: { id: affiliateUser.id },
                data: { balance: { increment: affiliateShare } }
            });

            // Cria linha no extrato do afiliado
            await tx.transaction.create({
                data: {
                    userId: affiliateUser.id,
                    productId: product?.id,
                    type: 'COMMISSION', // Tipo diferente para identificar comissão
                    amount: affiliateShare,
                    status: 'COMPLETED',
                    referenceId: deposit!.externalId,
                    description: `Comissão: ${product?.name}`,
                    paymentMethod: 'PIX',
                    customerName: deposit!.payerName, // Quem comprou
                    metadata: { ...payload, role: 'affiliate' } as any,
                }
            });
        }
      });

      // 5. Notifica Frontend via Socket (Tempo Real)
      try {
        if (this.paymentGateway) {
            // Notifica Produtor
            const freshProducer = await this.prisma.user.findUnique({where:{id:deposit.userId}});
            this.paymentGateway.emitToUser(deposit.userId, 'balance_updated', { 
                balance: freshProducer?.balance || 0 
            });
            this.paymentGateway.emitToUser(deposit.userId, 'sale_approved', { 
                amount: producerShare,
                productName: description 
            });

            // Notifica Afiliado (se houver)
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