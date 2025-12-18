// src/product/product.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { v4 as uuidv4 } from 'uuid';
import { MailService } from 'src/mail/mail.service'; // ✅ IMPORTADO

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  // ✅ MailService injetado
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService 
  ) {}

  private formatProduct(product: any) {
    if (!product) return null;
    return {
      ...product,
      title: product.name,
      amount: product.priceInCents,
      price: product.priceInCents / 100,
      image: product.imageUrl,
      // ✅ Expõe a área para o frontend
      memberAreaId: product.memberAreaId, 
      memberArea: product.memberArea
    };
  }

  // Normaliza configs visuais
  private normalizeCheckoutConfig(inputConfig: any, titleFallback: string, imageUrl?: string | null) {
    const cfg = inputConfig || {};
    const branding = cfg.branding || {};
    const rawBrandName = (branding.brandName ?? '').toString().trim();
    const shouldFixBrandName = !rawBrandName || rawBrandName.toLowerCase().includes('carregando');
    const nextBranding: any = { ...branding, brandName: shouldFixBrandName ? titleFallback : rawBrandName };
    if (imageUrl) { nextBranding.dashboardCover = imageUrl; nextBranding.productImage = imageUrl; }
    return { ...cfg, branding: nextBranding };
  }

  private generateSlug(name: string): string {
    const baseSlug = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${baseSlug}-${uuidv4().split('-')[0]}`;
  }

  async findAllByUser(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    const products = await this.prisma.product.findMany({
      where: { OR: [{ merchantId: userId }, ...(merchant?.id ? [{ merchantId: merchant.id }] : [])] },
      include: { offers: true, coupons: true, memberArea: true },
      orderBy: { createdAt: 'desc' },
    });
    return products.map((p) => this.formatProduct(p));
  }

  // ✅ CORREÇÃO CRÍTICA: Esta função estava faltando e quebrou o PublicApi
  async findAllByMerchant(merchantId: string) {
    const products = await this.prisma.product.findMany({
      where: { merchantId },
      include: { offers: true, coupons: true, memberArea: true },
      orderBy: { createdAt: 'desc' },
    });
    return products.map((p) => this.formatProduct(p));
  }

  async findById(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { offers: true, coupons: true, memberArea: true },
    });
    return this.formatProduct(product);
  }

  async create(dto: CreateProductDto, userId: string) {
    try {
      const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
      const ownerId = merchant ? merchant.id : userId;
      
      const priceVal = Number(dto.price);
      const priceInCents = isNaN(priceVal) ? 0 : Math.round(priceVal * 100);
      
      const finalConfig = this.normalizeCheckoutConfig(dto.checkoutConfig, dto.title, dto.imageUrl);

      // ✅ Tipagem correta para evitar erro no build
      let memberAreaId: string | null = null;
      
      if (dto.deliveryMethod === 'PAYLURE_MEMBERS') {
          const newArea = await this.prisma.memberArea.create({
              data: {
                  merchantId: ownerId,
                  name: dto.title,
                  description: dto.description,
                  slug: this.generateSlug(dto.title),
                  coverImageUrl: dto.imageUrl,
              }
          });
          memberAreaId = newArea.id;
          this.logger.log(`📚 Área Criada: ${newArea.name}`);
      }

      const newProduct = await this.prisma.product.create({
        data: {
          name: dto.title,
          description: dto.description || '',
          priceInCents,
          merchantId: ownerId,
          imageUrl: dto.imageUrl || null,
          category: dto.category || 'WEALTH',
          salesPageUrl: dto.salesPageUrl || null,
          deliveryMethod: dto.deliveryMethod || 'PAYLURE_MEMBERS',
          paymentType: dto.paymentType || 'ONE_TIME',
          subscriptionPeriod: dto.subscriptionPeriod || null,
          deliveryUrl: dto.deliveryUrl || null,
          fileUrl: dto.fileUrl || null,
          fileName: dto.fileName || null,
          
          memberAreaId: memberAreaId, 

          isAffiliationEnabled: Boolean(dto.isAffiliationEnabled),
          showInMarketplace: Boolean(dto.showInMarketplace),
          commissionPercent: Number(dto.commissionPercent || 0),
          affiliationType: dto.affiliationType || 'OPEN',
          materialLink: dto.materialLink || null,
          coproductionEmail: dto.coproductionEmail || null,
          coproductionPercent: Number(dto.coproductionPercent || 0),
          
          checkoutConfig: finalConfig,
          
          offers: { create: dto.offers?.map((o) => ({ name: o.name, priceInCents: Math.round(Number(o.price) * 100) })) || [] },
          coupons: { create: dto.coupons?.map((c) => ({ code: c.code.toUpperCase(), discountPercent: Number(c.discountPercent) })) || [] },
        },
        include: { offers: true, coupons: true, memberArea: true },
      });

      if (dto.showInMarketplace) {
        await this.prisma.marketplaceProduct.create({
            data: { productId: newProduct.id, status: 'AVAILABLE', commissionRate: Number(dto.commissionPercent || 0) },
        }).catch((e) => this.logger.warn(e));
      }

      // 🤝 ENVIA CONVITE SE TIVER CO-PRODUTOR NO CREATE
      if (dto.coproductionEmail) {
        const owner = await this.prisma.user.findUnique({ where: { id: userId } });
        await this.mailService.sendCoproductionInvite(
          dto.coproductionEmail,
          newProduct.name,
          Number(dto.coproductionPercent || 0),
          owner?.name || 'Produtor'
        );
      }

      return this.formatProduct(newProduct);
    } catch (error: any) {
      this.logger.error(`Erro create: ${error?.message || error}`);
      throw new BadRequestException('Erro ao criar produto.');
    }
  }

  async findOnePublic(id: string) { return this.findById(id); }
  
  async findMyCoProductions(email: string) {
    const prods = await this.prisma.product.findMany({
      where: { coproductionEmail: { equals: email, mode: 'insensitive' } },
      include: { offers: true, coupons: true, memberArea: true },
      orderBy: { createdAt: 'desc' },
    });
    return prods.map((p) => this.formatProduct(p));
  }

  async update(id: string, userId: string, email: string, dto: UpdateProductDto) {
      const product = await this.prisma.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException();
      
      // 🤝 LOGICA DE CONVITE DE CO-PRODUÇÃO
      if (dto.coproductionEmail && dto.coproductionEmail !== product.coproductionEmail) {
        const owner = await this.prisma.user.findUnique({ where: { id: userId } });
        await this.mailService.sendCoproductionInvite(
          dto.coproductionEmail,
          dto.title || product.name,
          Number(dto.coproductionPercent || product.coproductionPercent || 0),
          owner?.name || 'Um Produtor'
        );
      }

      const updated = await this.prisma.product.update({
          where: { id },
          data: { 
             ...(dto.title && { name: dto.title }),
             ...(dto.price && { priceInCents: Math.round(dto.price * 100) }),
             ...(dto.imageUrl && { imageUrl: dto.imageUrl }),
             ...(dto.deliveryMethod && { deliveryMethod: dto.deliveryMethod }),
             ...(dto.checkoutConfig && { checkoutConfig: dto.checkoutConfig }),
             
             // Atualiza co-produção
             ...(dto.coproductionEmail && { coproductionEmail: dto.coproductionEmail }),
             ...(dto.coproductionPercent && { coproductionPercent: Number(dto.coproductionPercent) }),
          },
          include: { offers: true, coupons: true, memberArea: true }
      });
      return this.formatProduct(updated);
  }

  // ✅ METODO REMOVE AJUSTADO PARA LIMPEZA PROFUNDA (RESOLVE ERRO 500)
  async remove(id: string, userId: string) {
    // 1. Verifica se o produto existe e busca suas dependências críticas
    const product = await this.prisma.product.findUnique({ 
        where: { id },
        include: { 
            marketplaceProduct: true, 
            paymentLinks: true 
        } 
    });
    
    if (!product) {
        throw new NotFoundException('Produto não encontrado');
    }

    // 2. Executa a exclusão em cascata manual (Transaction)
    await this.prisma.$transaction(async (tx) => {
        
        // --- ETAPA A: LIMPEZA DO MARKETPLACE ---
        if (product.marketplaceProduct) {
            // A1. Remove Afiliados (que impedem deletar o MarketplaceProduct)
            await tx.affiliate.deleteMany({
                where: { marketplaceProductId: product.marketplaceProduct.id }
            });

            // A2. Remove o produto do Marketplace
            await tx.marketplaceProduct.delete({
                where: { id: product.marketplaceProduct.id }
            });
        }

        // --- ETAPA B: LIMPEZA DE LINKS DE PAGAMENTO ---
        if (product.paymentLinks.length > 0) {
            const linkIds = product.paymentLinks.map(link => link.id);
            
            // B1. Desvincula depósitos dos links (para não apagar histórico financeiro, mas liberar o link)
            await tx.deposit.updateMany({
                where: { paymentLinkId: { in: linkIds } },
                data: { paymentLinkId: null }
            });

            // B2. Remove os Links de Pagamento
            await tx.paymentLink.deleteMany({
                where: { productId: id }
            });
        }

        // --- ETAPA C: DESVINCULAR TRANSAÇÕES ---
        // Desvincula transações financeiras do produto (mantém o registro da venda, mas sem o link)
        await tx.transaction.updateMany({
            where: { productId: id },
            data: { productId: null }
        });

        // --- ETAPA D: LIMPEZA FINAL ---
        // Apaga Ofertas e Cupons explicitamente (caso o banco não tenha cascade configurado)
        await tx.offer.deleteMany({ where: { productId: id } });
        await tx.coupon.deleteMany({ where: { productId: id } });

        // Finalmente, apaga o Produto
        await tx.product.delete({
            where: { id }
        });
    });

    return { message: 'Produto removido com sucesso' };
  }
}