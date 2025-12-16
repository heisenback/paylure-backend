// src/product/product.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================================================================
  // MÉTODOS PÚBLICOS (CORREÇÃO DO ERRO)
  // ==================================================================
  async findOnePublic(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { 
          merchant: { include: { user: { select: { name: true, email: true } } } },
          offers: true 
      }
    });
    if (!product) throw new NotFoundException('Produto não encontrado');

    return {
        ...product,
        title: product.name,
        amount: product.priceInCents
    };
  }

  // ==================================================================
  // CREATE
  // ==================================================================
  async create(dto: CreateProductDto, merchantId: string) {
    try {
        const priceVal = Number(dto.price);
        if (isNaN(priceVal)) throw new BadRequestException('Preço inválido.');
        const priceInCents = Math.round(priceVal * 100);

        let finalCheckoutConfig = dto.checkoutConfig || {};
        
        if (dto.imageUrl) {
            finalCheckoutConfig = {
                ...finalCheckoutConfig,
                branding: {
                    ...(finalCheckoutConfig.branding || {}),
                    dashboardCover: dto.imageUrl,
                    productImage: dto.imageUrl,
                    brandName: dto.title
                },
                deliveryMethod: dto.deliveryMethod || 'PAYLURE_MEMBERS'
            };
        }

        const commPercent = dto.commissionPercent ? Number(dto.commissionPercent) : 0;
        const coproPercent = dto.coproductionPercent ? Number(dto.coproductionPercent) : 0;

        const newProduct = await this.prisma.product.create({
          data: {
            name: dto.title,
            description: dto.description || '',
            priceInCents: priceInCents,
            merchantId: merchantId,
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
            commissionPercent: commPercent,
            affiliationType: dto.affiliationType || 'OPEN',
            materialLink: dto.materialLink || null,
            coproductionEmail: dto.coproductionEmail || null,
            coproductionPercent: coproPercent,
            content: dto.content || null,
            checkoutConfig: finalCheckoutConfig,
            offers: {
                create: dto.offers?.map(o => ({
                    name: o.name,
                    priceInCents: Math.round(Number(o.price) * 100)
                })) || []
            },
            coupons: {
                create: dto.coupons?.map(c => ({
                    code: c.code.toUpperCase(),
                    discountPercent: Number(c.discountPercent)
                })) || []
            }
          },
          include: { offers: true, coupons: true }
        });

        if (dto.showInMarketplace) {
            await this.prisma.marketplaceProduct.create({
                data: { productId: newProduct.id, status: 'AVAILABLE', commissionRate: commPercent }
            }).catch(e => this.logger.warn(`Erro marketplace: ${e.message}`));
        }

        return newProduct;

    } catch (error) {
        this.logger.error(`Erro create: ${error.message}`);
        throw new BadRequestException('Erro ao criar produto.');
    }
  }

  async findAllByMerchant(merchantId: string) {
    return this.prisma.product.findMany({ where: { merchantId }, include: { offers: true, coupons: true }, orderBy: { createdAt: 'desc' } });
  }

  async findMyCoProductions(userEmail: string) {
      return this.prisma.product.findMany({ where: { coproductionEmail: userEmail }, include: { offers: true, coupons: true }, orderBy: { createdAt: 'desc' } });
  }

  async findById(productId: string) {
    return this.prisma.product.findUnique({ where: { id: productId }, include: { offers: true, coupons: true } });
  }

  async remove(productId: string, merchantId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão.');
    try { await this.prisma.marketplaceProduct.deleteMany({ where: { productId } }); } catch (e) {}
    await this.prisma.product.delete({ where: { id: productId } });
  }

  // ==================================================================
  // UPDATE
  // ==================================================================
  async update(id: string, userId: string, userEmail: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Produto não encontrado');

    const isOwner = product.merchantId === userId;
    const isCoProducer = product.coproductionEmail === userEmail; 

    // Verifica Afiliado
    let isAffiliate = false;
    if (!isOwner && !isCoProducer) {
        const affiliation = await this.prisma.affiliate.findUnique({
            where: { promoterId_marketplaceProductId: { promoterId: userId, marketplaceProductId: id } }
        });
        if (affiliation?.status === 'APPROVED') isAffiliate = true;
    }

    if (!isOwner && !isCoProducer && !isAffiliate) throw new ForbiddenException('Sem permissão.');

    // REGRA AFILIADO
    if (isAffiliate && !isOwner && !isCoProducer) {
        if (dto.price || dto.title || dto.commissionPercent || dto.offers) {
            throw new ForbiddenException('Afiliados podem personalizar apenas o visual.');
        }
        return this.prisma.product.update({
            where: { id },
            data: { checkoutConfig: dto.checkoutConfig }
        });
    }

    // Lógica Dono
    const data: any = { ...dto };
    delete data.price; delete data.title; delete data.file; delete data.offers; delete data.coupons;

    if (dto.price !== undefined) data.priceInCents = Math.round(Number(dto.price) * 100);
    if (dto.title) data.name = dto.title;
    if (dto.salesPageUrl !== undefined) data.salesPageUrl = dto.salesPageUrl;

    if (dto.checkoutConfig) {
        data.checkoutConfig = dto.checkoutConfig;
    }
    
    if (dto.imageUrl) {
        data.imageUrl = dto.imageUrl;
        const baseConfig = (data.checkoutConfig as any) || (product.checkoutConfig as any) || {};
        data.checkoutConfig = {
            ...baseConfig,
            branding: {
                ...(baseConfig.branding || {}),
                dashboardCover: dto.imageUrl,
                productImage: dto.imageUrl,
            }
        };
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
                    productId: id, name: o.name, priceInCents: Math.round(Number(o.price) * 100)
                }))
            });
        }
    }

    if (dto.coupons) {
        await this.prisma.coupon.deleteMany({ where: { productId: id } });
        if (dto.coupons.length > 0) {
            await this.prisma.coupon.createMany({
                data: dto.coupons.map((c: any) => ({
                    productId: id, code: c.code.toUpperCase(), discountPercent: Number(c.percent || c.discountPercent)
                }))
            });
        }
    }

    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
        include: { offers: true, coupons: true }
    });
    
    if (isOwner || isCoProducer) {
        if (dto.commissionPercent !== undefined || dto.showInMarketplace !== undefined) {
             const commRate = (dto.commissionPercent !== undefined ? Number(dto.commissionPercent) : updated.commissionPercent) || 0;
             if (updated.showInMarketplace) {
                 const exists = await this.prisma.marketplaceProduct.findUnique({ where: { productId: id } });
                 if (exists) {
                     await this.prisma.marketplaceProduct.update({ where: { productId: id }, data: { commissionRate: commRate } });
                 } else {
                     await this.prisma.marketplaceProduct.create({ data: { productId: id, status: 'AVAILABLE', commissionRate: commRate } });
                 }
             } else {
                 await this.prisma.marketplaceProduct.deleteMany({ where: { productId: id } });
             }
        }
    }
    
    return updated;
  }
}