// src/checkout/checkout.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as crypto from 'crypto';
// ✅ CORREÇÃO: Importando o tipo User para a variável affiliateUser
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

    // --- CORREÇÃO DO TÍTULO (Items.0.title error) ---
    const cleanItems = dto.items?.map(item => ({
        ...item,
        title: item.title || product.name // Fallback para o nome do banco
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

    // --- LÓGICA DO AFILIADO ---
    let affiliateId: string | undefined = undefined;
    
    // ✅ CORREÇÃO: Declarando o tipo explicitamente para evitar erro TS2322
    let affiliateUser: User | null = null;
    
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
                 // Buscamos o usuário afiliado para pegar o CPF dele se precisar
                 affiliateUser = await this.prisma.user.findUnique({ where: { id: affiliateId }});
             }
        }
    }

    // --- 3. LÓGICA DE CPF/DOCUMENTO (Checkout Absoluto) ---
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    let finalPhone = dto.customer.phone ? dto.customer.phone.replace(/\D/g, '') : '11999999999';

    // Se o cliente não preencheu o CPF (oculto no checkout)
    if (!finalDocument || finalDocument.length < 11) {
        if (affiliateUser && affiliateUser.document) {
            // REGRA: Se tem afiliado, usa o CPF do afiliado
            finalDocument = affiliateUser.document.replace(/\D/g, '');
            this.logger.log(`Using Affiliate Document for fallback: ${finalDocument}`);
        } else {
            // REGRA: Se não, usa o CPF do Seller (Produtor)
            finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '00000000000';
            this.logger.log(`Using Seller Document for fallback: ${finalDocument}`);
        }
    }

    // Fallback final de segurança
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
            payerDocument: finalDocument, // CPF resolvido
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

        // 7. Salva Transação PRINCIPAL (Do Produtor) como PENDING
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
                customerPhone: finalPhone,     
                externalId: keyclubResult.transactionId,
                referenceId: keyclubResult.transactionId,
                pixQrCode: keyclubResult.qrcode,
                pixCopyPaste: keyclubResult.qrcode,
                metadata: { 
                    ref: affiliateId, 
                    offerId: dto.offerId,
                    items: cleanItems 
                } as any
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