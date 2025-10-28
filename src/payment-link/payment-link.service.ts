// src/payment-link/payment-link.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';

@Injectable()
export class PaymentLinkService {
  // Pedimos ao Nest para "injetar" (entregar) o PrismaService
  constructor(private readonly prisma: PrismaService) {}

  // Função para criar um novo link de pagamento
  async createPaymentLink(dto: CreatePaymentLinkDto, userId: string) {
    // 1. Achar a LOJA (Merchant) que pertence ao usuário logado
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId: userId },
    });

    // 2. Se o usuário não tem uma loja, ele não pode criar links!
    if (!merchant) {
      throw new ForbiddenException(
        'Você precisa ter uma loja (merchant) cadastrada para criar links de pagamento.',
      );
    }

    // 3. Se tudo estiver OK, criar o Link de Pagamento
    const paymentLink = await this.prisma.paymentLink.create({
      data: {
        title: dto.title,
        amount: dto.amount, // Valor em centavos
        // A "ligação" mais importante:
        // Amarra este link à LOJA do usuário
        merchant: {
          connect: {
            id: merchant.id,
          },
        },
      },
    });

    return paymentLink;
  }
}