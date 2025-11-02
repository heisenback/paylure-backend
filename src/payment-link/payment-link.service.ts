// src/payment-link/payment-link.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto'; 
import { PaymentLink } from '@prisma/client';

@Injectable()
export class PaymentLinkService {
  private readonly logger = new Logger(PaymentLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um novo link de pagamento (produto) para um Merchant.
   */
  async create(dto: CreatePaymentLinkDto, merchantId: string): Promise<PaymentLink> {
    
    const link = await this.prisma.paymentLink.create({
      data: {
        name: dto.title, 
        amountInCents: dto.amount,
        merchant: {
          connect: { id: merchantId },
        },
        
        // Estes campos são obrigatórios pelo seu schema.prisma
        slug: dto.slug,
        product: {
          connect: { id: dto.productId }
        }
      },
    });

    this.logger.log(`Link de Pagamento '${link.name}' criado com sucesso para o Merchant: ${merchantId}`);
    return link;
  }
}