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
    // 1. Busca Produto e Dados do Vendedor
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido.');

    const sellerUser = product.merchant.user;

    // 2. Calcula Valor (Base + Order Bumps se houver)
    let totalAmountInCents = Number(product.priceInCents); 
    if (dto.items && dto.items.length > 0) {
       // Soma itens extras (bumps) se houver lógica no front enviando tudo junto
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
       totalAmountInCents += bumpsTotal;
    }

    // Se for uma oferta específica, sobrescreve o valor base
    if (dto.offerId) {
        const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId }});
        if (offer) totalAmountInCents = offer.priceInCents;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor mínimo R$ 1,00.');

    // 3. Documento do Cliente
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    // Fallback: se não vier documento (checkout simples), usa do produtor (arriscado, mas mantido da sua lógica)
    if (!finalDocument || finalDocument.length < 11) {
        finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '';
    }
    if (!finalDocument) throw new BadRequestException('CPF/CNPJ obrigatório para emissão.');

    // 4. CÁLCULO DE COMISSÕES (SPLIT)
    let producerAmount = totalAmountInCents;
    let affiliateAmount = 0;
    let affiliateId: string | null = null;
    let coproducerAmount = 0;
    
    // ✅ A. Afiliação (LÓGICA CORRIGIDA AQUI)
    if (dto.ref) {
        // 1. Primeiro, descobre qual é o ID do produto no Marketplace
        const mpProduct = await this.prisma.marketplaceProduct.findUnique({
            where: { productId: product.id }
        });

        // Se o produto está no marketplace, tentamos achar o afiliado
        if (mpProduct) {
            const affiliate = await this.prisma.affiliate.findUnique({
                where: {
                    promoterId_marketplaceProductId: {
                        promoterId: dto.ref,
                        marketplaceProductId: mpProduct.id // 🎯 CORREÇÃO: Usa o ID do Marketplace, não do Produto
                    }
                }
            });

            // Só paga se estiver APROVADO
            if (affiliate && affiliate.status === 'APPROVED') {
                // Usa a comissão definida no Marketplace (prioridade) ou no Produto (fallback)
                const commRate = mpProduct.commissionRate ?? product.commissionPercent ?? 0;
                
                affiliateAmount = Math.round(totalAmountInCents * (commRate / 100));
                producerAmount -= affiliateAmount; // Deduz do produtor
                affiliateId = affiliate.promoterId;
                
                this.logger.log(`Split Afiliado: ${affiliateId} recebe ${affiliateAmount} (Rate: ${commRate}%)`);
            } else {
                this.logger.warn(`Afiliado ${dto.ref} inválido ou não aprovado para este produto.`);
            }
        }
    }

    // B. Co-produtor
    const coproPercent = product.coproductionPercent ? Number(product.coproductionPercent) : 0;
    
    if (product.coproductionEmail && coproPercent > 0) {
        const coproUser = await this.prisma.user.findUnique({ where: { email: product.coproductionEmail }});
        if (coproUser) {
            coproducerAmount = Math.round(totalAmountInCents * (coproPercent / 100));
            producerAmount -= coproducerAmount;
            this.logger.log(`Split Co-produtor: ${coproUser.id} recebe ${coproducerAmount}`);
        }
    }

    // 5. Integração Keyclub (Gateway)
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

        // 6. Salva no Banco (Depósito)
        await this.prisma.deposit.create({
            data: {
                id: externalId,
                externalId: keyclubResult.transactionId,
                amountInCents: totalAmountInCents,
                netAmountInCents: producerAmount, // Valor Líquido do Produtor
                status: 'PENDING',
                payerName: dto.customer.name,
                payerEmail: dto.customer.email,
                payerDocument: finalDocument,
                webhookToken: crypto.randomBytes(16).toString('hex'),
                userId: sellerUser.id,
                merchantId: product.merchant.id,
            }
        });

        // 7. Salva Transação (Extrato Detalhado)
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmountInCents,
                status: 'PENDING',
                type: 'SALE',
                paymentMethod: 'PIX',
                description: `Venda: ${product.name} ${affiliateId ? '(Com Afiliado)' : ''}`,
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
                
                // Se você já tiver criado os campos no Prisma, pode descomentar:
                // affiliateId: affiliateId,
                // affiliateAmount: affiliateAmount,
                // coproducerAmount: coproducerAmount
            }
        });

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