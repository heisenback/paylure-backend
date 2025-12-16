// src/checkout/checkout.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as crypto from 'crypto';
import { User } from '@prisma/client';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  async processCheckout(dto: CreatePaymentDto) {
    // 1. Busca Produto e Vendedor
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido.');

    const sellerUser = product.merchant.user;

    const cleanItems = dto.items?.map(item => ({
        ...item,
        title: item.title || product.name
    })) || [];

    // 2. Calcula Valor Total
    let totalAmountInCents = Number(product.priceInCents); 
    
    if (dto.offerId) {
        const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId }});
        if (offer) totalAmountInCents = offer.priceInCents;
    }

    if (cleanItems.length > 0) {
       const bumpsTotal = cleanItems
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor mínimo R$ 1,00.');

    // ✅ CORREÇÃO 4: LÓGICA COMPLETA DO AFILIADO
    let affiliateId: string | undefined = undefined;
    let affiliateUser: User | null = null;
    let commissionRate: number = 0;
    
    if (dto.ref) {
        const mpProduct = await this.prisma.marketplaceProduct.findUnique({
             where: { productId: product.id } 
        });
        
        if (mpProduct) {
             const affiliation = await this.prisma.affiliate.findUnique({
                 where: { 
                     promoterId_marketplaceProductId: { 
                         promoterId: dto.ref, 
                         marketplaceProductId: mpProduct.id 
                     } 
                 }
             });
             
             if (affiliation && affiliation.status === 'APPROVED') {
                 affiliateId = dto.ref;
                 commissionRate = mpProduct.commissionRate || product.commissionPercent || 0;
                 affiliateUser = await this.prisma.user.findUnique({ where: { id: affiliateId }});
                 
                 this.logger.log(`✅ Venda com afiliado: ${affiliateUser?.email} | Comissão: ${commissionRate}%`);
             }
        }
    }

    // 3. Lógica de CPF/Documento
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    let finalPhone = dto.customer.phone ? dto.customer.phone.replace(/\D/g, '') : '11999999999';

    if (!finalDocument || finalDocument.length < 11) {
        if (affiliateUser && affiliateUser.document) {
            finalDocument = affiliateUser.document.replace(/\D/g, '');
            this.logger.log(`Using Affiliate Document for fallback: ${finalDocument}`);
        } else {
            finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '00000000000';
            this.logger.log(`Using Seller Document for fallback: ${finalDocument}`);
        }
    }

    if (!finalDocument || finalDocument.length < 11) finalDocument = '00000000000';

    // 4. Gera ID Único Interno
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;

    try {
        // 5. Chama Gateway Keyclub
        const keyclubResult = await this.keyclubService.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: finalPhone
        });

        // 6. Salva Depósito
        await this.prisma.deposit.create({
            data: {
                id: externalId,
                externalId: keyclubResult.transactionId,
                amountInCents: totalAmountInCents,
                netAmountInCents: totalAmountInCents, 
                status: 'PENDING',
                payerName: dto.customer.name,
                payerEmail: dto.customer.email,
                payerDocument: finalDocument,
                webhookToken: crypto.randomBytes(16).toString('hex'),
                userId: sellerUser.id,
                merchantId: product.merchant.id,
            }
        });

        // ✅ 7. CALCULA SPLIT DE COMISSÃO
        const affiliateAmountInCents = affiliateId 
            ? Math.round(totalAmountInCents * (commissionRate / 100))
            : 0;
        
        const sellerAmountInCents = totalAmountInCents - affiliateAmountInCents;

        // 8. Salva Transação PRINCIPAL (Do Produtor) como PENDING
        await this.prisma.transaction.create({
            data: {
                id: externalId, 
                amount: sellerAmountInCents, // ✅ Valor já com desconto da comissão
                status: 'PENDING',
                type: 'SALE',
                paymentMethod: 'PIX',
                description: `Venda: ${product.name}`,
                userId: sellerUser.id, 
                productId: product.id,
                customerName: dto.customer.name,       
                customerEmail: dto.customer.email,     
                customerDoc: finalDocument,            
                customerPhone: finalPhone,     
                externalId: keyclubResult.transactionId,
                referenceId: keyclubResult.transactionId,
                pixQrCode: keyclubResult.qrcode,
                pixCopyPaste: keyclubResult.qrcode,
                metadata: { 
                    ref: affiliateId, 
                    offerId: dto.offerId,
                    items: cleanItems,
                    commissionRate: commissionRate,
                    affiliateAmount: affiliateAmountInCents
                } as any
            }
        });

        // ✅ 9. CRIA TRANSAÇÃO DO AFILIADO (Se houver)
        if (affiliateId && affiliateAmountInCents > 0) {
            await this.prisma.transaction.create({
                data: {
                    id: `${externalId}_aff`,
                    amount: affiliateAmountInCents,
                    status: 'PENDING',
                    type: 'COMMISSION',
                    paymentMethod: 'PIX',
                    description: `Comissão de Afiliado: ${product.name} (${commissionRate}%)`,
                    userId: affiliateId,
                    productId: product.id,
                    customerName: dto.customer.name,
                    customerEmail: dto.customer.email,
                    externalId: keyclubResult.transactionId,
                    referenceId: externalId,
                    metadata: {
                        isAffiliateCommission: true,
                        originalTransactionId: externalId,
                        sellerId: sellerUser.id,
                        commissionRate: commissionRate
                    } as any
                }
            });
            
            this.logger.log(`✅ Transação de comissão criada: R$ ${(affiliateAmountInCents/100).toFixed(2)} para afiliado ${affiliateId}`);
        }

        return {
            success: true,
            pix: {
                qrCode: keyclubResult.qrcode,
                copyPaste: keyclubResult.qrcode,
                transactionId: keyclubResult.transactionId 
            }
        };

    } catch (error: any) {
        this.logger.error(`Checkout Error: ${error.message}`);
        throw new BadRequestException('Erro ao gerar PIX. Verifique os dados ou tente novamente.');
    }
  }

  async checkTransactionStatus(id: string) {
    const tx = await this.prisma.transaction.findFirst({
        where: { 
            OR: [
                { externalId: id }, 
                { referenceId: id }, 
                { id: id }
            ] 
        },
        select: { status: true }
    });
    return { status: tx?.status || 'PENDING' };
  }
}