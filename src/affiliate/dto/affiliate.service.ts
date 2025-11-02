// src/affiliate/dto/affiliate.service.ts
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

// 🚨 CORREÇÃO (Erro TS2307): O DTO está na mesma pasta, não em './dto/...'
import { RequestAffiliateDto } from './request-affiliate.dto';
import { Affiliate } from '@prisma/client';

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. Solicita afiliação a um produto (feita pelo futuro afiliado).
   */
  async requestAffiliation(dto: RequestAffiliateDto): Promise<Affiliate> {
    
    // 1. Verificar se a afiliação já existe
    const existing = await this.prisma.affiliate.findUnique({
      where: {
        promoterId_marketplaceProductId: {
          promoterId: dto.promoterId!,
          marketplaceProductId: dto.marketplaceProductId,
        },
      },
    });

    if (existing) {
      if (existing.status === 'APPROVED') {
        throw new ConflictException('Você já é um afiliado aprovado para este produto.');
      }
      throw new ConflictException('Uma solicitação para este produto já está PENDENTE ou BLOQUEADA.');
    }

    // 2. Verificar se o produto existe no Marketplace
    const marketplaceProduct = await this.prisma.marketplaceProduct.findUnique({
      where: { id: dto.marketplaceProductId },
    });

    if (!marketplaceProduct) {
      throw new BadRequestException('O produto não está disponível no Marketplace.');
    }

    // 3. Criar o registro de afiliação (Status inicial: PENDING ou APPROVED direto)
    // Para simplificar o lançamento, vamos definir como APPROVED direto.
    const affiliation = await this.prisma.affiliate.create({
      data: {
        promoterId: dto.promoterId!,
        marketplaceProductId: dto.marketplaceProductId,
        status: 'APPROVED', // Afiliação Automática
      },
    });

    this.logger.log(`Nova afiliação APROVADA: Promoter ${dto.promoterId} para Produto ${dto.marketplaceProductId}`);
    return affiliation;
  }

  /**
   * 2. Lista todos os afiliados que promovem os produtos do Merchant logado (Painel do Seller).
   */
  async findAllByMerchant(merchantId: string) {
    // Busca todos os produtos do Merchant que estão no Marketplace
    const marketplaceProducts = await this.prisma.marketplaceProduct.findMany({
      where: {
        product: {
          merchantId: merchantId,
        },
      },
      select: {
        id: true,
        commissionRate: true,
        product: { select: { name: true, id: true } },
        affiliates: {
          where: { status: { not: 'BLOCKED' } },
          select: {
            id: true,
            promoterId: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    // Processar e unificar os resultados para o Frontend
    const allAffiliates = marketplaceProducts.flatMap(mp =>
      mp.affiliates.map(aff => ({
        id: aff.id,
        status: aff.status,
        commissionRate: mp.commissionRate,
        productName: mp.product.name,
        productId: mp.product.id,
        promoterId: aff.promoterId,
        // Futuro: Adicionar nome/email do promoter
        createdAt: aff.createdAt,
      }))
    );

    return allAffiliates;
  }
}