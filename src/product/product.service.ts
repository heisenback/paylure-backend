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
    };
  }

  /**
   * Normaliza o checkoutConfig para impedir brandName "Carregando..."
   * e preencher imagens quando houver imageUrl.
   */
  private normalizeCheckoutConfig(
    inputConfig: any,
    titleFallback: string,
    imageUrl?: string | null,
  ) {
    const cfg = inputConfig || {};
    const branding = cfg.branding || {};

    const rawBrandName = (branding.brandName ?? '').toString().trim();
    const shouldFixBrandName =
      !rawBrandName || rawBrandName.toLowerCase().includes('carregando');

    const nextBranding: any = {
      ...branding,
      brandName: shouldFixBrandName ? titleFallback : rawBrandName,
    };

    // Se tiver imagem, garante imagens no branding também
    if (imageUrl) {
      nextBranding.dashboardCover = imageUrl;
      nextBranding.productImage = imageUrl;
    }

    return {
      ...cfg,
      branding: nextBranding,
    };
  }

  async findAllByUser(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });

    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { merchantId: userId },
          ...(merchant?.id ? [{ merchantId: merchant.id }] : []),
        ],
      },
      include: { offers: true, coupons: true },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => this.formatProduct(p));
  }

  async findAllByMerchant(merchantId: string) {
    const products = await this.prisma.product.findMany({
      where: { merchantId },
      include: { offers: true, coupons: true },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => this.formatProduct(p));
  }

  async findById(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { offers: true, coupons: true },
    });
    return this.formatProduct(product);
  }

  async findOnePublic(id: string) {
    return this.findById(id);
  }

  async create(dto: CreateProductDto, userId: string) {
    try {
      const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
      const ownerId = merchant ? merchant.id : userId;

      const priceVal = Number(dto.price);
      const priceInCents = isNaN(priceVal) ? 0 : Math.round(priceVal * 100);

      // ✅ sempre normaliza o checkoutConfig
      const finalCheckoutConfig = this.normalizeCheckoutConfig(
        dto.checkoutConfig,
        dto.title,
        dto.imageUrl || null,
      );

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
          isAffiliationEnabled: Boolean(dto.isAffiliationEnabled),
          showInMarketplace: Boolean(dto.showInMarketplace),
          commissionPercent: Number(dto.commissionPercent || 0),
          affiliationType: dto.affiliationType || 'OPEN',
          materialLink: dto.materialLink || null,
          coproductionEmail: dto.coproductionEmail || null,
          coproductionPercent: Number(dto.coproductionPercent || 0),
          checkoutConfig: finalCheckoutConfig,
          offers: {
            create:
              dto.offers?.map((o) => ({
                name: o.name,
                priceInCents: Math.round(Number(o.price) * 100),
              })) || [],
          },
          coupons: {
            create:
              dto.coupons?.map((c) => ({
                code: c.code.toUpperCase(),
                discountPercent: Number(c.discountPercent),
              })) || [],
          },
        },
        include: { offers: true, coupons: true },
      });

      if (dto.showInMarketplace) {
        await this.prisma.marketplaceProduct
          .create({
            data: {
              productId: newProduct.id,
              status: 'AVAILABLE',
              commissionRate: Number(dto.commissionPercent || 0),
            },
          })
          .catch((e) => this.logger.warn(e));
      }

      return this.formatProduct(newProduct);
    } catch (error: any) {
      this.logger.error(`Erro create: ${error?.message || error}`);
      throw new BadRequestException('Erro ao criar produto.');
    }
  }

  async update(id: string, userId: string, userEmail: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado');

    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    const merchantId = merchant ? merchant.id : null;

    const isOwner =
      product.merchantId === userId ||
      (merchantId && product.merchantId === merchantId);

    // ✅ co-producer por email CASE-INSENSITIVE (evita “não aparece” por maiúsculas/minúsculas)
    const isCoProducer =
      (product.coproductionEmail || '').toLowerCase() === (userEmail || '').toLowerCase();

    let isAffiliate = false;
    if (!isOwner && !isCoProducer) {
      const affiliation = await this.prisma.affiliate.findUnique({
        where: {
          promoterId_marketplaceProductId: {
            promoterId: userId,
            marketplaceProductId: id,
          },
        },
      });
      if (affiliation?.status === 'APPROVED') isAffiliate = true;
    }

    if (!isOwner && !isCoProducer && !isAffiliate) {
      throw new ForbiddenException('Sem permissão.');
    }

    // ✅ Afiliado pode alterar apenas visual
    if (isAffiliate && !isOwner && !isCoProducer) {
      if (dto.price || dto.title || dto.commissionPercent || dto.offers || dto.coupons) {
        throw new ForbiddenException('Afiliados podem personalizar apenas o visual.');
      }

      const normalized = this.normalizeCheckoutConfig(
        dto.checkoutConfig,
        product.name,
        null,
      );

      const updated = await this.prisma.product.update({
        where: { id },
        data: { checkoutConfig: normalized },
        include: { offers: true, coupons: true },
      });

      return this.formatProduct(updated);
    }

    // Dono/Co-produtor
    const data: any = { ...dto };

    // removidos do "data" pq tratamos manualmente
    delete data.price;
    delete data.title;
    delete data.file;
    delete data.offers;
    delete data.coupons;

    if (dto.price !== undefined) data.priceInCents = Math.round(Number(dto.price) * 100);
    if (dto.title) data.name = dto.title;

    // ✅ Se vier checkoutConfig, normaliza
    if (dto.checkoutConfig) {
      const fallbackTitle = dto.title || product.name;
      data.checkoutConfig = this.normalizeCheckoutConfig(dto.checkoutConfig, fallbackTitle, null);
    }

    // ✅ Se trocar imagem, garante que o config também não fique "Carregando..."
    if (dto.imageUrl) {
      data.imageUrl = dto.imageUrl;
      const baseConfig = (data.checkoutConfig as any) || (product.checkoutConfig as any) || {};
      const fallbackTitle = dto.title || product.name;

      data.checkoutConfig = this.normalizeCheckoutConfig(baseConfig, fallbackTitle, dto.imageUrl);
    }

    if (dto.commissionPercent !== undefined) data.commissionPercent = Number(dto.commissionPercent);
    if (dto.coproductionPercent !== undefined) data.coproductionPercent = Number(dto.coproductionPercent);
    if (dto.isAffiliationEnabled !== undefined) data.isAffiliationEnabled = Boolean(dto.isAffiliationEnabled);
    if (dto.showInMarketplace !== undefined) data.showInMarketplace = Boolean(dto.showInMarketplace);

    if (dto.offers) {
      await this.prisma.offer.deleteMany({ where: { productId: id } });
      if (dto.offers.length > 0) {
        await this.prisma.offer.createMany({
          data: dto.offers.map((o: any) => ({
            productId: id,
            name: o.name,
            priceInCents: Math.round(Number(o.price) * 100),
          })),
        });
      }
    }

    if (dto.coupons) {
      await this.prisma.coupon.deleteMany({ where: { productId: id } });
      if (dto.coupons.length > 0) {
        await this.prisma.coupon.createMany({
          data: dto.coupons.map((c: any) => ({
            productId: id,
            code: c.code.toUpperCase(),
            discountPercent: Number(c.percent || c.discountPercent),
          })),
        });
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      include: { offers: true, coupons: true },
    });

    if (
      (isOwner || isCoProducer) &&
      (dto.commissionPercent !== undefined || dto.showInMarketplace !== undefined)
    ) {
      const commRate = updated.commissionPercent || 0;

      if (updated.showInMarketplace) {
        const exists = await this.prisma.marketplaceProduct.findUnique({
          where: { productId: id },
        });

        if (exists) {
          await this.prisma.marketplaceProduct.update({
            where: { productId: id },
            data: { commissionRate: commRate },
          });
        } else {
          await this.prisma.marketplaceProduct.create({
            data: { productId: id, status: 'AVAILABLE', commissionRate: commRate },
          });
        }
      } else {
        await this.prisma.marketplaceProduct.deleteMany({ where: { productId: id } });
      }
    }

    return this.formatProduct(updated);
  }

  async findMyCoProductions(userEmail: string) {
    // ✅ busca por email CASE-INSENSITIVE (prisma)
    const prods = await this.prisma.product.findMany({
      where: {
        coproductionEmail: {
          equals: userEmail,
          mode: 'insensitive',
        },
      },
      include: { offers: true, coupons: true },
      orderBy: { createdAt: 'desc' },
    });

    return prods.map((p) => this.formatProduct(p));
  }

  async remove(productId: string, userId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException();

    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    const merchantId = merchant ? merchant.id : null;

    if (product.merchantId !== userId && product.merchantId !== merchantId) {
      throw new ForbiddenException();
    }

    try {
      await this.prisma.marketplaceProduct.deleteMany({ where: { productId } });
    } catch (e) {}

    await this.prisma.product.delete({ where: { id: productId } });
  }
}
