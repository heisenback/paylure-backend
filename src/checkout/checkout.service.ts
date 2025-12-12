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

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido.');

    const sellerUser = product.merchant.user;

    // Calcula Valor
    let totalAmountInCents = Number(product.priceInCents); 
    if (dto.items && dto.items.length > 0) {
       const bumpsTotal = dto.items
            .filter(item => item.id !== product.id)
            .reduce((acc, item) => acc + item.price, 0);
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor mínimo R$ 1,00.');

    // Documento
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';
    if (!finalDocument || finalDocument.length < 11) {
        finalDocument = sellerUser.document?.replace(/\D/g, '') || product.merchant.cnpj?.replace(/\D/g, '') || '';
    }
    if (!finalDocument) throw new BadRequestException('CPF/CNPJ obrigatório.');

    // Integração Keyclub
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;
    let keyclubResult;

    try {
        keyclubResult = await this.keyclub.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // A. Cria DEPÓSITO (Para Webhook)
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

        // B. Cria TRANSAÇÃO (Para Extrato e Minhas Vendas)
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmountInCents,
                status: 'PENDING',
                type: 'SALE', // Importante para aparecer em Minhas Vendas
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
            }
        });

        return {
            success: true,
            pix: {
                qrCode: keyclubResult.qrcode,
                copyPaste: keyclubResult.qrcode,
                transactionId: keyclubResult.transactionId // Retorna o ID da Keyclub
            }
        };

    } catch (error: any) {
        this.logger.error(`[Checkout] Erro: ${error.message}`);
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

  // ✅ MÉTODO DE CONSULTA DE STATUS
  async checkTransactionStatus(id: string) {
    // Tenta achar na Transação (Prioridade)
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

    if (tx) return { status: tx.status };

    // Fallback: Depósito
    const dep = await this.prisma.deposit.findFirst({
        where: { 
            OR: [
                { externalId: id },
                { id: id }
            ]
        },
        select: { status: true }
    });

    return { status: dep?.status || 'PENDING' };
  }
}