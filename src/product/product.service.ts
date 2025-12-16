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
  // CRIAR PRODUTO (Mantido)
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

  // ==================================================================
  // LISTAR MEUS PRODUTOS (Produtor)
  // ==================================================================
  async findAllByMerchant(merchantId: string) {
    return this.prisma.product.findMany({
      where: { merchantId },
      include: { offers: true, coupons: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==================================================================
  // ✅ NOVO: LISTAR MINHAS CO-PRODUÇÕES (Co-produtor)
  // ==================================================================
  async findMyCoProductions(userEmail: string) {
      return this.prisma.product.findMany({
          where: {
              coproductionEmail: userEmail // Busca exata pelo email
          },
          include: { offers: true, coupons: true },
          orderBy: { createdAt: 'desc' }
      });
  }

  async findById(productId: string) {
    return this.prisma.product.findUnique({ 
        where: { id: productId },
        include: { offers: true, coupons: true }
    });
  }

  async remove(productId: string, merchantId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão.');

    try { await this.prisma.marketplaceProduct.deleteMany({ where: { productId } }); } catch (e) {}
    await this.prisma.product.delete({ where: { id: productId } });
  }

  // ==================================================================
  // ✅ ATUALIZAR (UPDATE) - A Lógica de Permissões Inteligente
  // ==================================================================
  async update(id: string, userId: string, userEmail: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) throw new NotFoundException('Produto não encontrado');

    // 1. Identifica quem é o usuário
    const isOwner = product.merchantId === userId;
    const isCoProducer = product.coproductionEmail === userEmail; // Verifica e-mail

    // Verifica se é afiliado APROVADO
    let isAffiliate = false;
    if (!isOwner && !isCoProducer) {
        const affiliation = await this.prisma.affiliate.findUnique({
            where: {
                promoterId_marketplaceProductId: {
                    promoterId: userId,
                    marketplaceProductId: id 
                }
            }
        });
        if (affiliation?.status === 'APPROVED') isAffiliate = true;
    }

    // 2. Bloqueio Geral
    if (!isOwner && !isCoProducer && !isAffiliate) {
        throw new ForbiddenException('Você não tem permissão para editar este produto.');
    }

    // 3. 🔒 REGRA PARA AFILIADO: Só pode editar Checkout Visual
    if (isAffiliate && !isOwner && !isCoProducer) {
        // Se tentar mudar preço, comissão, nome ou ofertas => ERRO
        if (dto.price || dto.title || dto.commissionPercent || dto.offers || dto.coproductionPercent) {
            throw new ForbiddenException('Afiliados podem personalizar apenas o visual do checkout (Branding/Pixel).');
        }
        
        // Permite apenas checkoutConfig
        // Nota: O ideal seria salvar um "AffiliateConfig" separado, mas para simplificar vamos deixar ele editar o config global ou retornar erro se não quiser permitir
        // *AJUSTE*: Como editar o config global afetaria o produtor, o correto para afiliado é NÃO salvar no produto principal, mas sim em uma tabela de config de afiliado.
        // Porem, para seguir seu pedido de "editar igual dono", vamos permitir salvar APENAS checkoutConfig por enquanto.
        
        return this.prisma.product.update({
            where: { id },
            data: { checkoutConfig: dto.checkoutConfig }
        });
    }

    // 4. Lógica Completa (Dono ou Co-produtor)
    const data: any = { ...dto };
    delete data.price; delete data.title; delete data.file; delete data.offers; delete data.coupons;

    if (dto.price !== undefined) data.priceInCents = Math.round(Number(dto.price) * 100);
    if (dto.title) data.name = dto.title;
    if (dto.salesPageUrl !== undefined) data.salesPageUrl = dto.salesPageUrl;

    if (dto.imageUrl) {
        const currentConfig = (product.checkoutConfig as any) || {};
        data.checkoutConfig = {
            ...currentConfig,
            branding: {
                ...(currentConfig.branding || {}),
                dashboardCover: dto.imageUrl,
                productImage: dto.imageUrl,
            }
        };
    }

    if (dto.commissionPercent !== undefined) data.commissionPercent = Number(dto.commissionPercent);
    if (dto.coproductionPercent !== undefined) data.coproductionPercent = Number(dto.coproductionPercent);

    if (dto.offers) {
        await this.prisma.offer.deleteMany({ where: { productId: id } });
        if (dto.offers.length > 0) {
            await this.prisma.offer.createMany({
                data: dto.offers.map((o: any) => ({
                    productId: id,
                    name: o.name,
                    priceInCents: Math.round(Number(o.price) * 100)
                }))
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
                    discountPercent: Number(c.percent || c.discountPercent)
                }))
            });
        }
    }

    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
        include: { offers: true, coupons: true }
    });
    
    // Atualiza Marketplace se necessário
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