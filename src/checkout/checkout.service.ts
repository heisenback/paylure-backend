// src/checkout/checkout.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as crypto from 'crypto';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  async processCheckout(dto: CreatePaymentDto) {
    // 1. Busca Produto
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido.');

    const sellerUser = product.merchant.user;

    // 2. Calcula Valor
    let totalAmountInCents = Number(product.priceInCents); 
    if (dto.items && dto.items.length > 0) {
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
       totalAmountInCents += bumpsTotal;
    }

    if (dto.offerId) {
        const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId }});
        if (offer) totalAmountInCents = offer.priceInCents;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor mínimo R$ 1,00.');

    // 3. Documento
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    if (!finalDocument || finalDocument.length < 11) {
        finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '';
    }
    if (!finalDocument) throw new BadRequestException('CPF/CNPJ obrigatório.');

    // 4. SPLIT
    let producerAmount = totalAmountInCents;
    let affiliateAmount = 0;
    let affiliateId: string | null = null;
    let coproducerAmount = 0;
    let coproducerId: string | null = null;
    
    // ✅ CORREÇÃO CRÍTICA: Busca ID do Marketplace para achar a afiliação correta
    if (dto.ref) {
        const mpProduct = await this.prisma.marketplaceProduct.findUnique({
            where: { productId: product.id }
        });

        if (mpProduct) {
            const affiliate = await this.prisma.affiliate.findUnique({
                where: {
                    promoterId_marketplaceProductId: {
                        promoterId: dto.ref,
                        marketplaceProductId: mpProduct.id // ID CORRETO AQUI
                    }
                }
            });

            if (affiliate && affiliate.status === 'APPROVED') {
                const commRate = mpProduct.commissionRate ?? product.commissionPercent ?? 0;
                affiliateAmount = Math.round(totalAmountInCents * (commRate / 100));
                producerAmount -= affiliateAmount; 
                affiliateId = affiliate.promoterId;
            }
        }
    }

    // Co-produção
    const coproPercent = product.coproductionPercent || 0;
    if (product.coproductionEmail && coproPercent > 0) {
        const coproUser = await this.prisma.user.findUnique({ where: { email: product.coproductionEmail }});
        if (coproUser) {
            coproducerAmount = Math.round(totalAmountInCents * (coproPercent / 100));
            producerAmount -= coproducerAmount; 
            coproducerId = coproUser.id;
        }
    }

    // 5. Gateway Keyclub
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;
    let keyclubResult;

    try {
        keyclubResult = await this.keyclubService.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // 6. Salvar Depósito
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

        // 7. Salvar Transação do Produtor
        await this.prisma.transaction.create({
            data: {
                id: externalId, 
                amount: producerAmount, 
                status: 'PENDING',
                type: 'SALE',
                paymentMethod: 'PIX',
                description: `Venda: ${product.name}`,
                userId: sellerUser.id, 
                productId: product.id,
                customerName: dto.customer.name,       
                customerEmail: dto.customer.email,     
                customerDoc: finalDocument,            
                customerPhone: dto.customer.phone,     
                externalId: keyclubResult.transactionId,
                referenceId: keyclubResult.transactionId,
                pixQrCode: keyclubResult.qrcode,
                pixCopyPaste: keyclubResult.qrcode,
                metadata: { affiliateId, affiliateAmount, coproducerId, coproducerAmount }
            }
        });

        // ✅ Transação do Afiliado
        if (affiliateId && affiliateAmount > 0) {
            await this.prisma.transaction.create({
                data: {
                    amount: affiliateAmount,
                    status: 'PENDING',
                    type: 'COMMISSION',
                    paymentMethod: 'Balance',
                    description: `Comissão: ${product.name}`,
                    userId: affiliateId,
                    productId: product.id,
                    externalId: keyclubResult.transactionId,
                    referenceId: externalId,
                    customerName: dto.customer.name.split(' ')[0] + '...',
                }
            });
        }

        // ✅ Transação do Co-produtor
        if (coproducerId && coproducerAmount > 0) {
            await this.prisma.transaction.create({
                data: {
                    amount: coproducerAmount,
                    status: 'PENDING',
                    type: 'COPRODUCTION',
                    paymentMethod: 'Balance',
                    description: `Co-produção: ${product.name}`,
                    userId: coproducerId,
                    productId: product.id,
                    externalId: keyclubResult.transactionId,
                    referenceId: externalId,
                }
            });
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
        throw new BadRequestException('Erro no processamento do pagamento.');
    }
  }

  async checkTransactionStatus(id: string) {
    const tx = await this.prisma.transaction.findFirst({
        where: { OR: [{ externalId: id }, { referenceId: id }, { id: id }] },
        select: { status: true }
    });
    return { status: tx?.status || 'PENDING' };
  }
}