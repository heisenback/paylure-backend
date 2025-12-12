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

    // 1. Busca Produto e Vendedor
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido (sem usuário vinculado).');

    const sellerUser = product.merchant.user;

    // 2. Calcula Valor Total (Produto Base + Order Bumps)
    let totalAmountInCents = Number(product.priceInCents); 
    
    if (dto.items && dto.items.length > 0) {
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
            
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor total inválido (mínimo R$ 1,00).');

    // 3. Validação de Documento (Prioridade: Cliente > Seller > CNPJ)
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    
    if (!finalDocument || finalDocument.length < 11) {
        // Fallback para documento do vendedor se for um teste ou falha
        finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '';
    }

    if (!finalDocument) throw new BadRequestException('Documento (CPF/CNPJ) obrigatório para gerar o PIX.');

    // 4. Integração Keyclub
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;
    let keyclubResult;

    try {
        this.logger.log(`[Checkout] Gerando PIX na Keyclub. Valor: R$ ${amountInBRL}`);

        keyclubResult = await this.keyclub.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // =====================================================================
        // 5. SALVAMENTO CRÍTICO (Isso faltava para aparecer no Dashboard)
        // =====================================================================
        
        // A. Cria DEPÓSITO (Para o Webhook encontrar depois)
        await this.prisma.deposit.create({
            data: {
                id: externalId, // ID interno igual ao enviado
                externalId: keyclubResult.transactionId, // ID da Keyclub
                amountInCents: totalAmountInCents,
                netAmountInCents: totalAmountInCents, 
                status: 'PENDING',
                payerName: dto.customer.name,
                payerEmail: dto.customer.email,
                payerDocument: finalDocument,
                webhookToken: crypto.randomBytes(16).toString('hex'),
                userId: sellerUser.id, // Vincula ao Vendedor
                merchantId: product.merchant.id,
            }
        });

        // B. Cria TRANSAÇÃO (Para aparecer no Extrato como VENDA PENDENTE)
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmountInCents,
                status: 'PENDING',
                type: 'SALE', // ✅ TIPO CORRETO
                paymentMethod: 'PIX',
                description: `Venda: ${product.name}`,
                
                userId: sellerUser.id,
                productId: product.id, // ✅ Link com Produto (Vital para métricas)
                
                // Dados do Lead/Cliente
                customerName: dto.customer.name,       
                customerEmail: dto.customer.email,     
                customerDoc: finalDocument,            
                customerPhone: dto.customer.phone,     

                externalId: keyclubResult.transactionId,
                referenceId: keyclubResult.transactionId,
                pixQrCode: keyclubResult.qrcode,
                pixCopyPaste: keyclubResult.qrcode,
            }
        });

        this.logger.log(`[Checkout] Transação salva com sucesso! ID: ${externalId}`);

        return {
            success: true,
            pix: {
                qrCode: keyclubResult.qrcode,
                copyPaste: keyclubResult.qrcode,
                transactionId: keyclubResult.transactionId
            }
        };

    } catch (error: any) {
        this.logger.error(`[Checkout] Erro: ${error.message}`);
        
        // Fallback: Se o banco falhar mas o PIX gerou, retorna o PIX pro cliente não travar
        if(keyclubResult) { 
             return {
                 success: true,
                 pix: {
                    qrCode: keyclubResult.qrcode,
                    copyPaste: keyclubResult.qrcode,
                    transactionId: keyclubResult.transactionId
                }
            };
        }
        throw new BadRequestException('Erro ao processar pagamento.');
    }
  }
}