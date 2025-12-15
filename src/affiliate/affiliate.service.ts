// src/affiliate/affiliate.service.ts
import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RequestAffiliateDto } from './dto/request-affiliate.dto';
import { Affiliate } from '@prisma/client';

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. Solicita afiliação a um produto
   * Lógica: Verifica a config do produto (OPEN ou APPROVAL) e define o status inicial.
   */
  async requestAffiliation(dto: RequestAffiliateDto): Promise<any> {
    
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
      if (existing.status === 'BLOCKED') {
        throw new ConflictException('Sua afiliação foi bloqueada pelo produtor.');
      }
      throw new ConflictException('Sua solicitação já está PENDENTE. Aguarde a aprovação.');
    }

    // 2. Buscar o produto no Marketplace e suas configurações originais
    const marketplaceProduct = await this.prisma.marketplaceProduct.findUnique({
      where: { id: dto.marketplaceProductId },
      include: { 
        product: { select: { affiliationType: true, name: true } } 
      }
    });

    if (!marketplaceProduct) {
      throw new BadRequestException('O produto não está disponível no Marketplace.');
    }

    // 3. Definir status inicial baseado na configuração do produto
    // OPEN = 1-Clique (Aprovado direto)
    // APPROVAL = Requer Aprovação (Pendente)
    const initialStatus = marketplaceProduct.product.affiliationType === 'OPEN' ? 'APPROVED' : 'PENDING';

    const affiliation = await this.prisma.affiliate.create({
      data: {
        promoterId: dto.promoterId!,
        marketplaceProductId: dto.marketplaceProductId,
        status: initialStatus, 
      },
    });

    this.logger.log(`Afiliação criada: ${initialStatus} - User ${dto.promoterId} -> Produto ${marketplaceProduct.product.name}`);
    
    return {
        ...affiliation,
        message: initialStatus === 'APPROVED' 
            ? 'Parabéns! Afiliação aprovada com sucesso.' 
            : 'Solicitação enviada! Aguarde a aprovação do produtor.'
    };
  }

  /**
   * 2. Lista todos os afiliados (Painel do Produtor)
   */
  async findAllByMerchant(merchantId: string) {
    const affiliates = await this.prisma.affiliate.findMany({
      where: {
        marketplaceProduct: {
            product: { merchantId: merchantId }
        }
      },
      include: {
        marketplaceProduct: {
            include: { product: { select: { id: true, name: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Busca dados dos usuários (promoters) manualmente pois não temos include direto no schema atual para User
    const userIds = affiliates.map(a => a.promoterId);
    const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true }
    });

    return affiliates.map(aff => {
        const promoter = users.find(u => u.id === aff.promoterId);
        return {
            id: aff.id,
            status: aff.status,
            commissionRate: aff.marketplaceProduct.commissionRate,
            productName: aff.marketplaceProduct.product.name,
            productId: aff.marketplaceProduct.product.id,
            promoterId: aff.promoterId,
            name: promoter?.name || 'Desconhecido',
            email: promoter?.email || '---',
            salesCount: 0, // Futuro: Implementar contagem real
            totalSalesValue: 0, // Futuro: Implementar valor real
            createdAt: aff.createdAt,
        };
    });
  }

  /**
   * 3. Atualizar Status (Aprovar/Bloquear)
   */
  async updateStatus(affiliateId: string, newStatus: string, merchantId: string) {
      const affiliate = await this.prisma.affiliate.findUnique({
          where: { id: affiliateId },
          include: { 
              marketplaceProduct: { include: { product: true } } 
          }
      });

      if (!affiliate) throw new NotFoundException('Afiliação não encontrada.');

      // Segurança: Verifica se o produto pertence ao merchant logado
      if (affiliate.marketplaceProduct.product.merchantId !== merchantId) {
          throw new ForbiddenException('Você não tem permissão para gerenciar este afiliado.');
      }

      return this.prisma.affiliate.update({
          where: { id: affiliateId },
          data: { status: newStatus }
      });
  }
}