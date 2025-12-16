// src/affiliate/affiliate.service.ts
import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RequestAffiliateDto } from './dto/request-affiliate.dto';

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. Solicita afiliação (Lógica Inteligente)
   */
  async requestAffiliation(dto: RequestAffiliateDto): Promise<any> {
    
    // Verifica duplicidade
    const existing = await this.prisma.affiliate.findUnique({
      where: {
        promoterId_marketplaceProductId: {
          promoterId: dto.promoterId!,
          marketplaceProductId: dto.marketplaceProductId,
        },
      },
    });

    if (existing) {
      if (existing.status === 'APPROVED') throw new ConflictException('Você já é afiliado deste produto.');
      if (existing.status === 'BLOCKED') throw new ConflictException('Sua afiliação foi bloqueada pelo produtor.');
      throw new ConflictException('Sua solicitação já está pendente. Aguarde aprovação.');
    }

    // Busca o produto no marketplace para ver a regra de afiliação
    const mpItem = await this.prisma.marketplaceProduct.findUnique({
      where: { id: dto.marketplaceProductId },
      include: { product: true }
    });

    if (!mpItem) throw new BadRequestException('Produto não encontrado no Marketplace.');

    // 🎯 Lógica Mágica: OPEN = Aprovado Direto / APPROVAL = Pendente
    const initialStatus = mpItem.product.affiliationType === 'OPEN' ? 'APPROVED' : 'PENDING';

    const affiliation = await this.prisma.affiliate.create({
      data: {
        promoterId: dto.promoterId!,
        marketplaceProductId: dto.marketplaceProductId,
        status: initialStatus,
      },
    });

    this.logger.log(`Afiliação ${initialStatus}: User ${dto.promoterId} -> Produto ${mpItem.product.name}`);
    
    return {
        ...affiliation,
        message: initialStatus === 'APPROVED' ? 'Parabéns! Afiliação aprovada com sucesso.' : 'Solicitação enviada! Aguarde a aprovação do produtor.'
    };
  }

  /**
   * 2. Lista afiliados do Produtor (Dashboard do Produtor)
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
            salesCount: 0, 
            totalSalesValue: 0,
            createdAt: aff.createdAt
        };
    });
  }

  /**
   * 3. Aprovar ou Bloquear (Ação do Produtor)
   */
  async updateStatus(affiliateId: string, newStatus: string, merchantId: string) {
      const affiliate = await this.prisma.affiliate.findUnique({
          where: { id: affiliateId },
          include: { marketplaceProduct: { include: { product: true } } }
      });

      if (!affiliate) throw new NotFoundException('Afiliado não encontrado.');

      if (affiliate.marketplaceProduct.product.merchantId !== merchantId) {
          throw new ForbiddenException('Você não tem permissão para gerenciar este afiliado.');
      }

      return this.prisma.affiliate.update({
          where: { id: affiliateId },
          data: { status: newStatus }
      });
  }

  /**
   * 4. ✅ BUSCAR MINHAS AFILIAÇÕES (Aba "Sou Afiliado")
   */
  async findMyAffiliations(userId: string) {
      const myAffiliations = await this.prisma.affiliate.findMany({
          where: { 
              promoterId: userId,
              status: 'APPROVED' // Só mostramos produtos que já pode vender
          },
          include: {
              marketplaceProduct: {
                  include: {
                      product: true 
                  }
              }
          },
          orderBy: { createdAt: 'desc' }
      });

      // Transforma no formato de "Product" para o frontend reaproveitar o card
      return myAffiliations.map(aff => {
          const prod = aff.marketplaceProduct.product;
          return {
              id: prod.id,
              title: prod.name,
              description: prod.description,
              amount: prod.priceInCents,
              priceInCents: prod.priceInCents, // Manter compatibilidade
              imageUrl: prod.imageUrl,
              category: prod.category,
              deliveryMethod: prod.deliveryMethod,
              paymentType: prod.paymentType,
              
              // Campos especiais para identificar que é afiliado
              isAffiliateProduct: true, 
              affiliateLink: `https://paylure.com.br/checkout/${prod.id}?ref=${aff.promoterId}`,
              commissionRate: aff.marketplaceProduct.commissionRate,
              
              createdAt: aff.createdAt,
              updatedAt: aff.updatedAt
          };
      });
  }
}