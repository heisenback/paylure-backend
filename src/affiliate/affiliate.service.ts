// src/affiliate/affiliate.service.ts
import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RequestAffiliateDto } from './dto/request-affiliate.dto';

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ... (Mantenha requestAffiliation, findAllByMerchant e updateStatus IGUAIS) ...
  // Vou omitir aqui para economizar espaço, mantenha o código anterior desses métodos
  // Se precisar, copie do passo anterior. O foco é o método abaixo:

  async requestAffiliation(dto: RequestAffiliateDto): Promise<any> {
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
      throw new ConflictException('Sua solicitação já está pendente.');
    }

    const mpItem = await this.prisma.marketplaceProduct.findUnique({
      where: { id: dto.marketplaceProductId },
      include: { product: true }
    });

    if (!mpItem) throw new BadRequestException('Produto não encontrado.');

    const initialStatus = mpItem.product.affiliationType === 'OPEN' ? 'APPROVED' : 'PENDING';

    const affiliation = await this.prisma.affiliate.create({
      data: {
        promoterId: dto.promoterId!,
        marketplaceProductId: dto.marketplaceProductId,
        status: initialStatus,
      },
    });

    return {
        ...affiliation,
        message: initialStatus === 'APPROVED' ? 'Parabéns! Afiliação aprovada.' : 'Solicitação enviada! Aguarde aprovação.'
    };
  }

  async findAllByMerchant(merchantId: string) {
    const affiliates = await this.prisma.affiliate.findMany({
      where: { marketplaceProduct: { product: { merchantId: merchantId } } },
      include: { marketplaceProduct: { include: { product: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' }
    });

    const userIds = affiliates.map(a => a.promoterId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });

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
            createdAt: aff.createdAt,
        };
    });
  }

  async updateStatus(affiliateId: string, newStatus: string, merchantId: string) {
      const affiliate = await this.prisma.affiliate.findUnique({
          where: { id: affiliateId },
          include: { marketplaceProduct: { include: { product: true } } }
      });
      if (!affiliate) throw new NotFoundException('Afiliação não encontrada.');
      if (affiliate.marketplaceProduct.product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão.');

      return this.prisma.affiliate.update({ where: { id: affiliateId }, data: { status: newStatus } });
  }

  // ✅ ATUALIZADO: Busca ofertas extras para gerar links múltiplos
  async findMyAffiliations(userId: string) {
      const myAffiliations = await this.prisma.affiliate.findMany({
          where: { 
              promoterId: userId,
              status: 'APPROVED'
          },
          include: {
              marketplaceProduct: {
                  include: {
                      // 🔹 INCLUIR AS OFERTAS AQUI
                      product: {
                          include: { offers: true }
                      }
                  }
              }
          },
          orderBy: { createdAt: 'desc' }
      });

      return myAffiliations.map(aff => {
          const prod = aff.marketplaceProduct.product;
          return {
              id: prod.id,
              title: prod.name,
              description: prod.description,
              amount: prod.priceInCents,
              priceInCents: prod.priceInCents,
              imageUrl: prod.imageUrl,
              category: prod.category,
              deliveryMethod: prod.deliveryMethod,
              paymentType: prod.paymentType,
              
              isAffiliateProduct: true,
              affiliateLink: `https://paylure.com.br/checkout/${prod.id}?ref=${aff.promoterId}`,
              myRefId: aff.promoterId, // ✅ ID para construir links das ofertas
              
              // ✅ Repassar a lista de ofertas para o front
              offers: prod.offers.map(o => ({
                  id: o.id,
                  name: o.name,
                  priceInCents: o.priceInCents
              })),
              
              commissionRate: aff.marketplaceProduct.commissionRate,
              createdAt: aff.createdAt
          };
      });
  }
}