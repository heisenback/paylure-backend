// src/product/product.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto'; // <--- Import Novo
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

  // --- FUNÇÃO DE REMOÇÃO ---
  async remove(productId: string, merchantId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    if (product.merchantId !== merchantId) {
      this.logger.warn(`Tentativa de exclusão ilegal: Merchant ${merchantId} tentou apagar produto ${productId}.`);
      throw new ForbiddenException('Você não tem permissão para excluir este produto.');
    }

    await this.prisma.product.delete({
      where: { id: productId },
    });

    this.logger.log(`Produto ${productId} excluído com sucesso por Merchant ${merchantId}`);
  }

  // --- NOVA FUNÇÃO DE UPDATE (SALVAR CHECKOUT) ---
  async update(id: string, merchantId: string, dto: UpdateProductDto) {
    // 1. Busca e Verifica Dono
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) {
        throw new NotFoundException('Produto não encontrado');
    }

    if (product.merchantId !== merchantId) {
        throw new ForbiddenException('Sem permissão para editar este produto');
    }

    // 2. Prepara os dados
    const data: any = { ...dto };
    
    // Converte preço se vier
    if (dto.price !== undefined) {
        data.priceInCents = Math.round(dto.price * 100);
        delete data.price; // Remove o campo original do DTO
    }

    // Mapeia title para name (se vier do front como title)
    if (dto.title) {
        data.name = dto.title;
        delete data.title;
    }

    // 3. Atualiza no Banco
    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
    });
    
    this.logger.log(`Produto ${id} atualizado com sucesso (Config Checkout Salva).`);
    return updated;
  }
}