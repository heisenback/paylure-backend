import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service'; // ✅ Reusando sua integração
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as crypto from 'crypto';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclub: KeyclubService, // Injeção do serviço existente
  ) {}

  async processCheckout(dto: CreatePaymentDto) {
    this.logger.log(`[Checkout] Iniciando pagamento para Produto ID: ${dto.productId}`);

    // 1. Busca o Produto e o Seller (Merchant)
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: true }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant) throw new BadRequestException('Produto sem vendedor configurado.');

    // 2. Calcula o Valor Total (Produto + Order Bumps)
    let totalAmount = Number(product.priceInCents); // Valor base

    if (dto.items && dto.items.length > 0) {
       // Soma os bumps (Opcional: você pode validar os IDs dos bumps no banco se quiser ser mais rigoroso)
       const bumpsTotal = dto.items.reduce((acc, item) => acc + item.price, 0);
       totalAmount += bumpsTotal;
    }

    // 3. 🛡️ Lógica de Fallback do CPF (Sua regra de ouro)
    // Prioridade: 1. CPF do Cliente -> 2. CPF/CNPJ do Seller
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';

    if (!finalDocument || finalDocument.length < 11) {
        this.logger.warn(`[Checkout] Cliente sem CPF. Usando documento do Seller.`);
        finalDocument = product.merchant.document ? product.merchant.document.replace(/\D/g, '') : '';
        
        // Se o merchant usa CNPJ field
        if (!finalDocument && product.merchant.cnpj) {
            finalDocument = product.merchant.cnpj.replace(/\D/g, '');
        }
    }

    if (!finalDocument) {
        throw new BadRequestException('Não foi possível processar o pagamento: CPF/CNPJ não identificado.');
    }

    // 4. Gera ID Único da Transação
    const externalId = `chk_${crypto.randomUUID()}`;

    // 5. Chama a Keyclub (Usando seu serviço existente)
    // Convertemos centavos para Reais, pois a Keyclub espera float (ex: 29.90)
    const amountInBRL = totalAmount / 100;

    try {
        const keyclubResult = await this.keyclub.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument, // ✅ Documento garantido
            payerPhone: dto.customer.phone
        });

        // 6. Salva a Venda no Banco de Dados (Tabela Transaction ou Sales)
        // Adaptando para sua estrutura (supondo que você usa a tabela Transaction ou Deposit)
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmount, // Salva em centavos
                status: 'PENDING',
                type: 'DEPOSIT', // Ou 'SALE' se tiver esse enum
                description: `Venda: ${product.name}`,
                paymentMethod: 'PIX',
                
                // Relacionamentos
                productId: product.id,
                merchantId: product.merchant.id,
                
                // Dados do Cliente
                customerName: dto.customer.name,
                customerEmail: dto.customer.email,
                customerDocument: finalDocument,
                
                // Referência Externa
                externalReference: keyclubResult.transactionId
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
        this.logger.error(`[Checkout] Erro na Keyclub: ${error.message}`);
        throw new BadRequestException('Falha ao gerar PIX de pagamento.');
    }
  }
}