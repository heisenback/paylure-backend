// src/product/product.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- CREATE (AGORA SALVA TUDO E BLINDADO) ---
  async create(dto: CreateProductDto, merchantId: string): Promise<Product> {
    try {
        // Converte preço para centavos com segurança
        const priceVal = Number(dto.price);
        if (isNaN(priceVal)) {
            throw new BadRequestException('Preço inválido.');
        }
        const priceInCents = Math.round(priceVal * 100);

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

        // Garante que campos numéricos opcionais sejam números ou null/0
        const commPercent = dto.commissionPercent ? Number(dto.commissionPercent) : 0;
        const coproPercent = dto.coproductionPercent ? Number(dto.coproductionPercent) : 0;

        // 2. Cria o Produto
        const newProduct = await this.prisma.product.create({
          data: {
            name: dto.title,
            description: dto.description || '',
            priceInCents: priceInCents,
            merchantId: merchantId,
            
            // Imagem e Categoria
            imageUrl: dto.imageUrl || null,
            category: dto.category || 'WEALTH',
            
            // ✅ Entrega e Pagamento
            deliveryMethod: dto.deliveryMethod || 'PAYLURE_MEMBERS',
            paymentType: dto.paymentType || 'ONE_TIME',
            subscriptionPeriod: dto.subscriptionPeriod || null,
            
            // ✅ Arquivos e Links Externos
            deliveryUrl: dto.deliveryUrl || null,
            fileUrl: dto.fileUrl || null,
            fileName: dto.fileName || null,
            
            // ✅ Marketplace e Afiliação
            isAffiliationEnabled: Boolean(dto.isAffiliationEnabled),
            showInMarketplace: Boolean(dto.showInMarketplace),
            commissionPercent: commPercent,
            affiliationType: dto.affiliationType || 'OPEN',
            materialLink: dto.materialLink || null,
            
            // ✅ Co-produção
            coproductionEmail: dto.coproductionEmail || null,
            coproductionPercent: coproPercent,

            // Conteúdo e Config
            content: dto.content || null,
            checkoutConfig: finalCheckoutConfig,
          },
        });

        // 3. Cria entrada no Marketplace se necessário
        if (dto.showInMarketplace) {
            await this.prisma.marketplaceProduct.create({
                data: {
                    productId: newProduct.id,
                    status: 'AVAILABLE',
                    commissionRate: commPercent / 100 
                }
            }).catch(e => this.logger.warn(`Erro ao criar marketplace entry: ${e.message}`));
        }

        this.logger.log(`Produto '${newProduct.name}' criado com sucesso.`);
        return newProduct;

    } catch (error) {
        this.logger.error(`Erro ao criar produto: ${error.message}`, error.stack);
        // Se for erro do Prisma, repassa
        if (error.code) {
            throw new BadRequestException(`Erro de banco de dados: ${error.message}`);
        }
        throw error;
    }
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

    // Remove do marketplace primeiro (se existir)
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

    const data: any = { ...dto };
    
    // Remove campos que precisam de tratamento especial
    delete data.price;
    delete data.title;

    // Tratamento de Preço
    if (dto.price !== undefined) {
        data.priceInCents = Math.round(Number(dto.price) * 100);
    }

    // Tratamento de Título
    if (dto.title) {
        data.name = dto.title;
    }

    // Tratamento de Imagem e Config
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

    // Tratamento de numéricos opcionais
    if (dto.commissionPercent !== undefined) data.commissionPercent = Number(dto.commissionPercent);
    if (dto.coproductionPercent !== undefined) data.coproductionPercent = Number(dto.coproductionPercent);

    const updated = await this.prisma.product.update({
        where: { id },
        data: data,
    });
    
    // Atualiza marketplace se mudou comissão
    if (dto.commissionPercent !== undefined && updated.showInMarketplace) {
         await this.prisma.marketplaceProduct.updateMany({
            where: { productId: id },
            data: { commissionRate: Number(dto.commissionPercent) / 100 }
         }).catch(() => {}); // Ignora se não existir
    }
    
    return updated;
  }
}