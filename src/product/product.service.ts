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
import { MailService } from 'src/mail/mail.service'; 

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

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
      memberAreaId: product.memberAreaId, 
      memberArea: product.memberArea
    };
  }

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
      const merchant = await this.prisma.merchant.findUnique({ where: { userId }, include: { user: true } });
      const ownerId = merchant ? merchant.id : userId;
      
      const priceVal = Number(dto.price);
      const priceInCents = isNaN(priceVal) ? 0 : Math.round(priceVal * 100);
      
      const finalConfig = this.normalizeCheckoutConfig(dto.checkoutConfig, dto.title, dto.imageUrl);

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
        include: { offers: true, coupons: true, memberArea: true, merchant: { include: { user: true } } },
      });

      if (dto.showInMarketplace) {
        await this.prisma.marketplaceProduct.create({
            data: { productId: newProduct.id, status: 'AVAILABLE', commissionRate: Number(dto.commissionPercent || 0) },
        }).catch((e) => this.logger.warn(e));
      }

      if (newProduct.coproductionEmail) {
        await this.mailService.sendCoproductionInvite(
          newProduct.coproductionEmail,
          newProduct.name,
          Number(newProduct.coproductionPercent || 0),
          newProduct.merchant.user.name
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

  // 🔥 MÉTODO UPDATE CORRIGIDO 🔥
  async update(id: string, userId: string, email: string, dto: UpdateProductDto) {
      const product = await this.prisma.product.findUnique({ 
        where: { id },
        include: { merchant: { include: { user: true } } }
      });
      if (!product) throw new NotFoundException();
      
      if (dto.coproductionEmail && dto.coproductionEmail !== product.coproductionEmail) {
        await this.mailService.sendCoproductionInvite(
          dto.coproductionEmail,
          dto.title || product.name,
          Number(dto.coproductionPercent || product.coproductionPercent || 0),
          product.merchant.user.name
        );
      }

      const isRemovingCopro = dto.coproductionEmail === '';

      const updated = await this.prisma.product.update({
          where: { id },
          data: { 
             ...(dto.title && { name: dto.title }),
             ...(dto.description && { description: dto.description }), // Adicionado
             ...(dto.price && { priceInCents: Math.round(dto.price * 100) }),
             ...(dto.imageUrl && { imageUrl: dto.imageUrl }),
             ...(dto.category && { category: dto.category }), // Adicionado
             
             // ✅ CORREÇÃO: AGORA SALVA OS LINKS!
             ...(dto.salesPageUrl !== undefined && { salesPageUrl: dto.salesPageUrl }),
             ...(dto.materialLink !== undefined && { materialLink: dto.materialLink }),
             
             ...(dto.deliveryMethod && { deliveryMethod: dto.deliveryMethod }),
             ...(dto.deliveryUrl !== undefined && { deliveryUrl: dto.deliveryUrl }),
             ...(dto.fileUrl !== undefined && { fileUrl: dto.fileUrl }),
             ...(dto.fileName !== undefined && { fileName: dto.fileName }),
             
             // ✅ CORREÇÃO: DADOS DE AFILIAÇÃO
             ...(dto.isAffiliationEnabled !== undefined && { isAffiliationEnabled: dto.isAffiliationEnabled }),
             ...(dto.showInMarketplace !== undefined && { showInMarketplace: dto.showInMarketplace }),
             ...(dto.commissionPercent !== undefined && { commissionPercent: dto.commissionPercent }),
             ...(dto.affiliationType !== undefined && { affiliationType: dto.affiliationType }),

             ...(dto.checkoutConfig && { checkoutConfig: dto.checkoutConfig }),
             
             ...(dto.coproductionEmail !== undefined && { 
                 coproductionEmail: isRemovingCopro ? null : dto.coproductionEmail 
             }),
             ...(dto.coproductionPercent !== undefined && { 
                 coproductionPercent: isRemovingCopro ? 0 : Number(dto.coproductionPercent) 
             }),
          },
          include: { offers: true, coupons: true, memberArea: true }
      });
      return this.formatProduct(updated);
  }

  async remove(id: string, userId: string) {
    const product = await this.prisma.product.findUnique({ 
        where: { id },
        include: { marketplaceProduct: true, paymentLinks: true } 
    });
    
    if (!product) throw new NotFoundException('Produto não encontrado');

    await this.prisma.$transaction(async (tx) => {
        if (product.marketplaceProduct) {
            await tx.affiliate.deleteMany({ where: { marketplaceProductId: product.marketplaceProduct.id } });
            await tx.marketplaceProduct.delete({ where: { id: product.marketplaceProduct.id } });
        }
        if (product.paymentLinks.length > 0) {
            const linkIds = product.paymentLinks.map(link => link.id);
            await tx.deposit.updateMany({ where: { paymentLinkId: { in: linkIds } }, data: { paymentLinkId: null } });
            await tx.paymentLink.deleteMany({ where: { productId: id } });
        }
        await tx.transaction.updateMany({ where: { productId: id }, data: { productId: null } });
        await tx.offer.deleteMany({ where: { productId: id } });
        await tx.coupon.deleteMany({ where: { productId: id } });
        await tx.product.delete({ where: { id } });
    });

    return { message: 'Produto removido com sucesso' };
  }
}