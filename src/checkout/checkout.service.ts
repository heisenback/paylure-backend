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

    // 1. Busca Produto, Merchant e o User vinculado
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant || !product.merchant.user) throw new BadRequestException('Vendedor sem conta de usuário vinculada.');

    const sellerUser = product.merchant.user; // User (Seller)

    // 2. CORREÇÃO DE VALOR: Inicia com o preço base do produto e soma SÓ os bumps
    let totalAmountInCents = Number(product.priceInCents); 
    
    if (dto.items && dto.items.length > 0) {
       // Soma apenas os Bumps, ignorando o produto principal (para evitar o dobro)
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
            
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor total da compra inválido (mínimo R$ 1,00).');

    // 3. 🛡️ REGRA DEFINITIVA DO DOCUMENTO
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    const isCustomerDocumentValid = finalDocument && (finalDocument.length === 11 || finalDocument.length === 14); // CPF/CNPJ
    
    if (!isCustomerDocumentValid) {
        this.logger.warn(`[Checkout] Cliente não forneceu documento válido. Usando documento do Seller.`);
        
        // 🥇 Tenta CPF do User (Seller)
        if (sellerUser.document) {
            finalDocument = sellerUser.document.replace(/\D/g, '');
        } 
        // 🥈 Tenta CNPJ do Merchant (Se não for PF)
        else if (product.merchant.cnpj) {
            finalDocument = product.merchant.cnpj.replace(/\D/g, '');
        }
    }

    if (!finalDocument) throw new BadRequestException('Documento obrigatório para gerar PIX não encontrado.');

    // 4. Integração Keyclub
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;

    let keyclubResult;

    try {
        this.logger.log(`[Checkout] Gerando PIX na Keyclub. Valor: R$ ${amountInBRL} | Doc FINAL: ${finalDocument}`);

        // O DepositService deve ter uma estrutura similar a CreateDepositRequest
        keyclubResult = await this.keyclub.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // 5. ✅ CORREÇÃO DO SALVAMENTO (Alinhado com schema.prisma)
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmountInCents,
                status: 'PENDING',
                type: 'SALE', // Usando 'SALE'
                paymentMethod: 'PIX',
                description: `Venda: ${product.name}`,
                
                // RELACIONAMENTOS
                userId: sellerUser.id, // O User dono da conta
                productId: product.id,           
                
                // DADOS DO CLIENTE (Nomes do Schema)
                customerName: dto.customer.name,       
                customerEmail: dto.customer.email,     
                customerDoc: finalDocument,            
                customerPhone: dto.customer.phone,     

                externalId: keyclubResult.transactionId, // ID da Keyclub
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
            this.logger.warn(`[Checkout] Salvamento no DB falhou, mas PIX foi gerado na Keyclub. Retornando PIX.`);
            return {
                 success: true,
                 pix: {
                    qrCode: keyclubResult.qrcode,
                    copyPaste: keyclubResult.qrcode,
                    transactionId: keyclubResult.transactionId
                }
            };
        }
        
        throw new BadRequestException('Falha ao gerar o PIX. Tente novamente.');
    }
  }
}