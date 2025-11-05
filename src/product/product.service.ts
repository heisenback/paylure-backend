// src/product/product.service.ts
import { Injectable, Logger } from '@nestjs/common';
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
}