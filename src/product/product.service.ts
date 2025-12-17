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

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  private formatProduct(product: any) {
    if (!product) return null;
    return {
      ...product,
      title: product.name,
      amount: product.priceInCents,
      price: product.priceInCents / 100,
      image: product.imageUrl,
      // ✅ AJUSTE: Expõe a área para o frontend saber o ID
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

  // Gera slug único (ex: "curso-de-ingles-a1b2")
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
      // ✅ Inclui memberArea na busca
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
      const priceInCents = Math.round(Number(dto.price) * 100);
      const finalConfig = this.normalizeCheckoutConfig(dto.checkoutConfig, dto.title, dto.imageUrl);

      // ✅ LÓGICA AUTOMÁTICA: Cria a MemberArea se for curso
      let memberAreaId = null;
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
          
          memberAreaId: memberAreaId, // ✅ Vincula

          isAffiliationEnabled: Boolean(dto.isAffiliationEnabled),
          showInMarketplace: Boolean(dto.showInMarketplace),
          commissionPercent: Number(dto.commissionPercent || 0),
          affiliationType: dto.affiliationType || 'OPEN',
          materialLink: dto.materialLink || null,
          coproductionEmail: dto.coproductionEmail || null,
          coproductionPercent: Number(dto.coproductionPercent || 0),
          checkoutConfig: finalCheckoutConfig,
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

      return this.formatProduct(newProduct);
    } catch (error: any) {
      this.logger.error(`Erro create: ${error?.message || error}`);
      throw new BadRequestException('Erro ao criar produto.');
    }
  }

  // Mantenha os outros métodos (update, remove, findOnePublic, findMyCoProductions) como já estavam
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
      // ... (mantenha sua lógica de validação de update existente) ...
      
      const updated = await this.prisma.product.update({
          where: { id },
          data: { 
             // ... seus dados mapeados aqui ...
             name: dto.title, 
             // (Para brevidade, assumindo que o DTO é processado igual ao create, 
             //  mas o importante é o include abaixo)
          },
          include: { offers: true, coupons: true, memberArea: true }
      });
      return this.formatProduct(updated);
  }
  async remove(id: string, userId: string) {
      const product = await this.prisma.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException();
      // ... validações ...
      await this.prisma.product.delete({ where: { id } });
  }
}