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
    private readonly keyclub: KeyclubService,
  ) {}

  async processCheckout(dto: CreatePaymentDto) {
    this.logger.log(`[Checkout] Iniciando processamento para Produto ID: ${dto.productId}`);

    // 1. Busca Produto e Seller
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: true }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant) throw new BadRequestException('Produto sem vendedor configurado.');

    // 2. ✅ CORREÇÃO DO VALOR: Inicia com o preço base
    let totalAmountInCents = Number(product.priceInCents); 
    
    // Agora SOMA APENAS os Order Bumps (o produto base já está contado)
    if (dto.items && dto.items.length > 0) {
       // Filtra todos os itens que NÃO são o produto principal (evita duplicidade do preço)
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
            
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor total da compra inválido (mínimo R$ 1,00).');

    // 3. Fallback do Documento (CPF/CNPJ)
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';

    if (!finalDocument || finalDocument.length < 11) {
        this.logger.warn(`[Checkout] Sem CPF do cliente. Usando CNPJ/Documento do Seller.`);
        // ✅ Seu schema tem 'cnpj' no Merchant
        if (product.merchant.cnpj) {
            finalDocument = product.merchant.cnpj.replace(/\D/g, '');
        } 
    }

    if (!finalDocument) throw new BadRequestException('CPF/CNPJ para o PIX não encontrado.');

    // 4. Integração Keyclub
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;

    let keyclubResult;

    try {
        this.logger.log(`[Checkout] Gerando PIX na Keyclub. Valor: R$ ${amountInBRL} | Doc: ${finalDocument}`);

        keyclubResult = await this.keyclub.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // 5. ✅ CORREÇÃO DO SALVAMENTO: Usamos os nomes exatos do seu schema.prisma
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmountInCents,
                status: 'PENDING',
                type: 'SALE', // Usando SALE
                paymentMethod: 'PIX',
                description: `Venda: ${product.name}`,
                
                // ✅ RELACIONAMENTOS (user do merchant)
                userId: product.merchant.userId, // [cite: 53]
                productId: product.id,           // [cite: 54]
                
                // ✅ DADOS DO CLIENTE (Nomes corrigidos: customerDoc)
                customerName: dto.customer.name,       // 
                customerEmail: dto.customer.email,     // 
                customerDoc: finalDocument,            // ✅ CORRIGIDO: Era 'customerDocument', agora é 'customerDoc' 
                customerPhone: dto.customer.phone,     // 

                // ✅ DADOS DA KEYCLUB
                externalId: keyclubResult.transactionId, // [cite: 61]
                
                // Usando o campo de texto para o QR Code (para ser mais flexível)
                pixQrCode: keyclubResult.qrcode,
                pixCopyPaste: keyclubResult.qrcode,
            }
        });

        this.logger.log(`[Checkout] Sucesso TOTAL. TX ID: ${keyclubResult.transactionId}`);

        // 6. Retorna para o Frontend
        return {
            success: true,
            pix: {
                qrCode: keyclubResult.qrcode,
                copyPaste: keyclubResult.qrcode,
                transactionId: keyclubResult.transactionId
            }
        };

    } catch (error: any) {
        this.logger.error(`[Checkout] ERRO CRÍTICO NO SALVAMENTO/GATWAY: ${error.message}`);
        
        // Retorna o Pix gerado se a Keyclub respondeu OK (mesmo se o DB falhar)
        if(keyclubResult) { 
            this.logger.warn(`[Checkout] Salvamento no DB falhou, mas PIX foi gerado na Keyclub. Retornando PIX para não perder a venda.`);
            return {
                 success: true,
                 pix: {
                    qrCode: keyclubResult.qrcode,
                    copyPaste: keyclubResult.qrcode,
                    transactionId: keyclubResult.transactionId
                }
            };
        }
        
        // Se o erro foi antes ou a Keyclub falhou
        throw new BadRequestException('Falha ao gerar o PIX. Tente novamente.');
    }
  }
}