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

  // --- CREATE (ATUALIZADO - ELITE) ---
  async create(dto: CreateProductDto, merchantId: string): Promise<Product> {
    const priceInCents = Math.round(dto.price * 100);

    // 1. Prepara o Config do Checkout (Garante que a imagem vá para o branding)
    let finalCheckoutConfig = dto.checkoutConfig || {};
    
    // Se enviou imagem no formulário, garante que ela esteja também no branding do checkout
    if (dto.imageUrl) {
        finalCheckoutConfig = {
            ...finalCheckoutConfig,
            branding: {
                ...(finalCheckoutConfig.branding || {}),
                dashboardCover: dto.imageUrl,
                productImage: dto.imageUrl,
                brandName: dto.title
            },
            // Salva delivery method no config também para backup/redundância
            deliveryMethod: dto.deliveryMethod || 'PAYLURE_MEMBERS'
        };
    }

    // 2. Cria o Produto usando as novas colunas
    const newProduct = await this.prisma.product.create({
      data: {
        name: dto.title,
        description: dto.description || '',
        priceInCents: priceInCents,
        merchantId: merchantId,
        
        // ✅ Salvando nas colunas novas
        imageUrl: dto.imageUrl,
        category: dto.category || 'WEALTH',
        deliveryMethod: dto.deliveryMethod || 'PAYLURE_MEMBERS',
        paymentType: dto.paymentType || 'ONE_TIME',
        
        // ✅ NOVO: Campo content (módulos e aulas)
        content: dto.content || null,
        
        checkoutConfig: finalCheckoutConfig,
      },
    });

    // 3. Lógica de Marketplace (Se habilitado no frontend)
    if (dto.showInMarketplace) {
        await this.prisma.marketplaceProduct.create({
            data: {
                productId: newProduct.id,
                status: 'AVAILABLE',
                commissionRate: 0.5 // Padrão 50%, se precisar customizar, adicione ao DTO
            }
        }).catch(e => this.logger.warn('Erro ao criar entrada no marketplace', e));
    }

    this.logger.log(`Produto '${newProduct.name}' criado com sucesso (Delivery: ${newProduct.deliveryMethod})`);
    return newProduct;
  }

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

    // Tenta remover dependências do marketplace antes de deletar o produto
    try {
        await this.prisma.marketplaceProduct.deleteMany({ where: { productId } });
    } catch (e) {
        this.logger.warn(`Não foi possível remover do marketplace: ${e.message}`);
    }

    await this.prisma.product.delete({ where: { id: productId } });
  }

  // --- UPDATE (✅ CORRIGIDO PARA ACEITAR CONTENT) ---
  async update(id: string, merchantId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) throw new NotFoundException('Produto não encontrado');
    if (product.merchantId !== merchantId) throw new ForbiddenException('Sem permissão');

    const data: any = { ...dto };
    
    // Converte Preço
    if (dto.price !== undefined) {
        data.priceInCents = Math.round(dto.price * 100);
        delete data.price;
    }

    // Mapeia title -> name
    if (dto.title) {
        data.name = dto.title;
        delete data.title;
    }

    // ✅ CRÍTICO: Aceita o campo content (módulos e aulas)
    if (dto.content !== undefined) {
        // Se vier como string, mantém string
        // Se vier como objeto, o Prisma converte automaticamente para JSON
        data.content = dto.content;
        this.logger.log(`📦 Salvando conteúdo do curso para produto ${id}`);
    }

    // Se atualizar a imagem, atualiza o checkoutConfig automaticamente
    if (data.imageUrl) {
        const currentConfig = (product.checkoutConfig as any) || {};
        data.checkoutConfig = {
            ...currentConfig,
            branding: {
                ...(currentConfig.branding || {}),
                dashboardCover: data.imageUrl,
                productImage: data.imageUrl,
            }
        };
    }

    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
    });
    
    this.logger.log(`✅ Produto ${id} atualizado. Novo preço: R$ ${(updated.priceInCents / 100).toFixed(2)}`);
    
    // Log extra se salvou conteúdo
    if (dto.content) {
        const contentData = typeof dto.content === 'string' ? JSON.parse(dto.content) : dto.content;
        const moduleCount = Array.isArray(contentData) ? contentData.length : 0;
        this.logger.log(`📚 Conteúdo salvo: ${moduleCount} módulo(s)`);
    }
    
    return updated;
  }
}