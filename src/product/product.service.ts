// src/product/product.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- CREATE (AGORA SALVA TUDO) ---
  async create(dto: CreateProductDto, merchantId: string): Promise<Product> {
    const priceInCents = Math.round(dto.price * 100);

    // 1. Prepara o Config do Checkout
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

    // 2. Cria o Produto mapeando TODOS os campos do DTO para o Banco
    const newProduct = await this.prisma.product.create({
      data: {
        name: dto.title,
        description: dto.description || '',
        priceInCents: priceInCents,
        merchantId: merchantId,
        
        // Imagem e Categoria
        imageUrl: dto.imageUrl,
        category: dto.category || 'WEALTH',
        
        // ✅ Entrega e Pagamento
        deliveryMethod: dto.deliveryMethod || 'PAYLURE_MEMBERS',
        paymentType: dto.paymentType || 'ONE_TIME',
        subscriptionPeriod: dto.subscriptionPeriod,
        
        // ✅ Arquivos e Links Externos
        deliveryUrl: dto.deliveryUrl,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName,
        
        // ✅ Marketplace e Afiliação
        isAffiliationEnabled: dto.isAffiliationEnabled || false,
        showInMarketplace: dto.showInMarketplace || false,
        commissionPercent: dto.commissionPercent ? Number(dto.commissionPercent) : 0,
        affiliationType: dto.affiliationType,
        materialLink: dto.materialLink,
        
        // ✅ Co-produção
        coproductionEmail: dto.coproductionEmail,
        coproductionPercent: dto.coproductionPercent ? Number(dto.coproductionPercent) : 0,

        // Conteúdo e Config
        content: dto.content || null,
        checkoutConfig: finalCheckoutConfig,
      },
    });

    // 3. Cria entrada na tabela MarketplaceProduct se necessário
    if (dto.showInMarketplace) {
        await this.prisma.marketplaceProduct.create({
            data: {
                productId: newProduct.id,
                status: 'AVAILABLE',
                commissionRate: (dto.commissionPercent || 0) / 100 // Salva como decimal (ex: 0.5 para 50%)
            }
        }).catch(e => this.logger.warn('Erro ao criar entrada no marketplace (pode já existir)', e));
    }

    this.logger.log(`Produto '${newProduct.name}' criado com sucesso.`);
    return newProduct;
  }

  // --- MÉTODOS PADRÃO ---

  async findAllByMerchant(merchantId: string): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(productId: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id: productId } });
  }

  async remove(productId: string, merchantId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão.');

    try {
        await this.prisma.marketplaceProduct.deleteMany({ where: { productId } });
    } catch (e) {
        this.logger.warn(`Não foi possível remover do marketplace: ${e.message}`);
    }

    await this.prisma.product.delete({ where: { id: productId } });
  }

  // --- UPDATE (ATUALIZADO) ---
  async update(id: string, merchantId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) throw new NotFoundException('Produto não encontrado');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão');

    // Mapeia DTO para dados do Prisma
    const data: any = { 
        ...dto,
        // Remove campos que precisam de conversão manual
        price: undefined, 
        title: undefined 
    };
    
    // Converte Preço
    if (dto.price !== undefined) {
        data.priceInCents = Math.round(dto.price * 100);
    }

    // Mapeia title -> name
    if (dto.title) {
        data.name = dto.title;
    }

    // Se atualizar a imagem, atualiza o checkoutConfig
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

    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
    });
    
    return updated;
  }
}