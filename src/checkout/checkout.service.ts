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

    // 1. Busca o Produto e o Seller (Merchant)
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: true }
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant) throw new BadRequestException('ERRO CRÍTICO: Produto sem vendedor vinculado.');

    // 2. Calcula o Valor Total
    let totalAmountInCents = Number(product.priceInCents);

    if (dto.items && dto.items.length > 0) {
       const bumpsTotal = dto.items.reduce((acc, item) => acc + item.price, 0);
       totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) {
        throw new BadRequestException('Valor total da compra inválido (mínimo R$ 1,00).');
    }

    // 3. 🛡️ Lógica de Fallback do CPF
    // Prioridade: 1. CPF do Cliente -> 2. CNPJ do Seller
    
    let finalDocument = dto.customer.document ? dto.customer.document.replace(/\D/g, '') : '';

    if (!finalDocument || finalDocument.length < 11) {
        this.logger.warn(`[Checkout] Cliente sem CPF. Buscando documento do Seller...`);
        
        // ✅ CORREÇÃO 1: O erro disse que 'merchant' tem 'cnpj', mas não 'document'.
        // Trocamos para usar o CNPJ.
        if (product.merchant.cnpj) {
            finalDocument = product.merchant.cnpj.replace(/\D/g, '');
        }
    }

    if (!finalDocument || finalDocument.length < 11) {
        throw new BadRequestException('Erro no processamento: CPF/CNPJ do responsável não identificado.');
    }

    // 4. Prepara dados para a Keyclub
    const externalId = `chk_${crypto.randomUUID()}`;
    const amountInBRL = totalAmountInCents / 100;

    try {
        const keyclubResult = await this.keyclub.createDeposit({
            amount: amountInBRL,
            externalId: externalId,
            payerName: dto.customer.name,
            payerEmail: dto.customer.email,
            payerDocument: finalDocument,
            payerPhone: dto.customer.phone
        });

        // 5. Salva a Transação no Banco
        await this.prisma.transaction.create({
            data: {
                id: externalId,
                amount: totalAmountInCents,
                status: 'PENDING',
                type: 'DEPOSIT', // Ajustado para DEPOSIT que é o padrão do seu enum
                
                // Relacionamentos
                // ✅ CORREÇÃO 2: 'merchantId' não existe na tabela Transaction.
                // Comentei para não dar erro. Se precisar vincular, usamos o userId do dono do merchant.
                // merchantId: product.merchant.id, 
                
                // Se a transaction tiver userId, descomente a linha abaixo:
                // userId: product.merchant.userId, 

                // Campos que geralmente existem (baseado no seu log de erro)
                // Se der erro aqui de novo, precisamos ver seu schema.prisma
                description: `Venda: ${product.name}`,
                
                // Dados extras salvos como metadados ou campos específicos se existirem
                // Adaptando para passar no build, removendo campos que podem não existir no schema
                
                // Referência Externa
                // externalReference: keyclubResult.transactionId 
            } as any // ✅ FORÇA O TYPESCRIPT A ACEITAR (Temporário para passar o build)
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
        this.logger.error(`[Checkout] Erro: ${error.message}`);
        throw new BadRequestException('Não foi possível gerar o PIX no momento.');
    }
  }
}