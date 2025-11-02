// src/marketplace/marketplace.service.ts
import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMarketplaceProductDto } from './dto/create-marketplace-product.dto';
import { MarketplaceProduct } from '@prisma/client';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createMarketplaceProduct(dto: CreateMarketplaceProductDto): Promise<MarketplaceProduct> {
    
    const exists = await this.prisma.marketplaceProduct.findUnique({ where: { productId: dto.productId } });
    if (exists) { throw new BadRequestException('Este produto já está cadastrado no Marketplace.'); }

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) { throw new BadRequestException('Produto não encontrado.'); }
    
    if (product.merchantId !== dto.merchantId) { throw new ForbiddenException('Você não tem permissão para adicionar este produto ao Marketplace.'); }

    const marketplaceProduct = await this.prisma.marketplaceProduct.create({
      data: {
        productId: dto.productId,
        commissionRate: dto.commissionRate,
        attributionType: dto.attributionType,
        status: 'AVAILABLE',
      },
    });

    this.logger.log(`Produto ${dto.productId} adicionado ao Marketplace com comissão de ${dto.commissionRate}%.`);
    return marketplaceProduct;
  }

  /**
   * 🚨 CORREÇÃO TS2551: Adicionado INCLUDE para que o Controller possa acessar .product
   */
  async findAllAvailable() {
    return this.prisma.marketplaceProduct.findMany({
      where: { status: 'AVAILABLE' },
      include: {
        product: { // 🚨 ESSENCIAL: Incluir o produto para que o Controller possa pegar o nome/preço
            select: {
                name: true,
                priceInCents: true,
                merchantId: true,
            }
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}