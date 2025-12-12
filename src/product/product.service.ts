// src/product/product.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- CREATE (Mantido igual) ---
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

    this.logger.log(`Produto '${newProduct.name}' criado: R$ ${dto.price}`);
    return newProduct;
  }

  async findAllByMerchant(merchantId: string): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(productId: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id: productId } });
  }

  async remove(productId: string, merchantId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão.');

    await this.prisma.product.delete({ where: { id: productId } });
  }

  // --- UPDATE PADRONIZADO ---
  async update(id: string, merchantId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) throw new NotFoundException('Produto não encontrado');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão');

    // Clona o DTO para manipular os dados
    const data: any = { ...dto };
    
    // ✅ LÓGICA ÚNICA: Se vier 'price' (Reais), converte para Centavos
    if (dto.price !== undefined) {
        data.priceInCents = Math.round(dto.price * 100);
        delete data.price; // Remove 'price' pois não existe na tabela do banco
    }

    // Mapeia title para name (compatibilidade com frontend)
    if (dto.title) {
        data.name = dto.title;
        delete data.title;
    }

    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
    });
    
    this.logger.log(`Produto ${id} atualizado. Novo preço: R$ ${(updated.priceInCents / 100).toFixed(2)}`);
    return updated;
  }
}