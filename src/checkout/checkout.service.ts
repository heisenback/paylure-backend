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
    // 1. Busca Produto e Vendedor
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido.');

    const sellerUser = product.merchant.user;

    // 2. Calcula Valor Total (Produto + Order Bumps + Ofertas)
    let totalAmountInCents = Number(product.priceInCents); 
    
    // Se tiver oferta específica, sobrescreve o preço base
    if (dto.offerId) {
        const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId }});
        if (offer) totalAmountInCents = offer.priceInCents;
    }

    // Soma Order Bumps
    if (dto.items && dto.items.length > 0) {
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor mínimo R$ 1,00.');

    // 3. Valida Documento do Pagador
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    // Fallback se o cliente não mandou documento
    if (!finalDocument || finalDocument.length < 11) {
        finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '00000000000';
    }

    // 4. Identifica Afiliado (Apenas para Metadados)
    let affiliateId: string | undefined = undefined;
    
    if (dto.ref) {
        // Verifica se é um afiliado válido para este produto
        const mpProduct = await this.prisma.marketplaceProduct.findUnique({
             where: { productId: product.id } 
        });
        
        if (mpProduct) {
             // Busca a afiliação usando o ID composto
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
             }
        }
    }

    // 5. Gera ID Único Interno
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;

    try {
        // 6. Chama Gateway Keyclub
        // Enviamos o 'ref' nos metadados para o Webhook pegar depois!
        const keyclubResult = await this.keyclubService.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // 7. Salva Depósito
        await this.prisma.deposit.create({
            data: {
                id: externalId, // Nosso ID interno
                externalId: keyclubResult.transactionId, // ID da Keyclub
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

        // 8. Salva Transação PRINCIPAL (Do Produtor) como PENDING
        // Salvamos o afiliado nos METADATA para o Webhook ler depois
        await this.prisma.transaction.create({
            data: {
                id: externalId, 
                amount: totalAmountInCents,
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
                metadata: { 
                    ref: affiliateId, 
                    offerId: dto.offerId,
                    items: dto.items 
                }
            }
        });

        // NOTA: As transações de comissão serão criadas pelo Webhook quando pagar.

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
        throw new BadRequestException('Erro ao gerar PIX. Verifique os dados.');
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