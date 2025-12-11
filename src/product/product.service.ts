// src/product/product.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto, merchantId: string): Promise<Product> {
    const priceInCents = Math.round(dto.price * 100);

    const newProduct = await this.prisma.product.create({
      data: {
        name: dto.title,
        description: dto.description || '',
        priceInCents: priceInCents,
        merchantId: merchantId,
      },
    });

    this.logger.log(`Produto '${newProduct.name}' criado com sucesso por Merchant ${merchantId}`);
    return newProduct;
  }

  async findAllByMerchant(merchantId: string): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(productId: string): Promise<Product | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
    });
  }

  // --- NOVA FUNÇÃO DE REMOÇÃO SEGURA ---
  async remove(productId: string, merchantId: string): Promise<void> {
    // 1. Verifica se o produto existe
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    // 2. Verifica se o produto pertence ao merchant que está tentando apagar
    if (product.merchantId !== merchantId) {
      this.logger.warn(`Tentativa de exclusão ilegal: Merchant ${merchantId} tentou apagar produto ${productId} de outro dono.`);
      throw new ForbiddenException('Você não tem permissão para excluir este produto.');
    }

    // 3. Deleta
    await this.prisma.product.delete({
      where: { id: productId },
    });

    this.logger.log(`Produto ${productId} excluído com sucesso por Merchant ${merchantId}`);
  }
}