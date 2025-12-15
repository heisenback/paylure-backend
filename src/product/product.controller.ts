// src/product/product.controller.ts
import { 
  Controller, 
  Post, 
  Get, 
  Delete,
  Patch, 
  Param, 
  Body, 
  UseGuards, 
  HttpStatus, 
  HttpCode, 
  Logger, 
  ForbiddenException,
  NotFoundException 
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';

@Controller('products')
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(private readonly productService: ProductService) {}

  // ==================================================================
  // ROTA PÚBLICA (Checkout)
  // ==================================================================
  @Get('public/:id')
  async findOnePublic(@Param('id') id: string) {
    const product = await this.productService.findById(id);
    
    if (!product) {
        throw new NotFoundException('Produto não encontrado ou indisponível.');
    }
    
    return {
      success: true,
      data: {
        id: product.id,
        title: product.name,
        description: product.description,
        amount: product.priceInCents,
        checkoutConfig: product.checkoutConfig,
        paymentType: product.paymentType,
        subscriptionPeriod: product.subscriptionPeriod,
        imageUrl: product.imageUrl // Importante para o checkout
      }
    };
  }

  // ==================================================================
  // ROTAS PROTEGIDAS (Dashboard)
  // ==================================================================

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateProductDto,
    @GetUser() user: any, 
  ) {
    if (!user.merchant?.id) {
      throw new ForbiddenException('Erro de Perfil: Produtor não identificado.');
    }

    const product = await this.productService.create(dto, user.merchant.id);

    return {
      success: true,
      message: 'Produto criado com sucesso.',
      data: product, // Retorna o objeto completo
    };
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async findAll(@GetUser() user: any) {
    if (!user.merchant?.id) {
        throw new ForbiddenException('Usuário não tem um Merchant ID associado.');
    }

    const products = await this.productService.findAllByMerchant(user.merchant.id);

    // ✅ CORREÇÃO: Mapeando TODOS os campos para o Frontend
    // Antes faltava isAffiliationEnabled, showInMarketplace, etc.
    return {
      success: true,
      data: products.map((p) => ({
        id: p.id,
        title: p.name, // O Front usa 'title'
        name: p.name,
        description: p.description,
        
        // Preços
        amount: p.priceInCents,
        price: p.priceInCents / 100,
        
        // Status
        isAvailable: p.isAvailable,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,

        // Imagens e Configurações
        imageUrl: p.imageUrl,
        image: p.imageUrl, // Fallback
        category: p.category,
        checkoutConfig: p.checkoutConfig,
        content: p.content,

        // Entrega
        deliveryMethod: p.deliveryMethod,
        paymentType: p.paymentType,
        subscriptionPeriod: p.subscriptionPeriod,
        deliveryUrl: p.deliveryUrl,
        fileUrl: p.fileUrl,
        fileName: p.fileName,
        file: p.fileUrl,

        // ✅ AQUI ESTAVA FALTANDO: Campos de Afiliação e Marketplace
        isAffiliationEnabled: p.isAffiliationEnabled,
        showInMarketplace: p.showInMarketplace,
        commissionPercent: p.commissionPercent,
        affiliationType: p.affiliationType,
        materialLink: p.materialLink,
        
        // Co-produção
        coproductionEmail: p.coproductionEmail,
        coproductionPercent: p.coproductionPercent,
      })),
    };
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @GetUser() user: any
  ) {
      if (!user.merchant?.id) {
          throw new ForbiddenException('Acesso negado.');
      }

      const updatedProduct = await this.productService.update(id, user.merchant.id, dto);

      return {
          success: true,
          message: 'Produto atualizado com sucesso!',
          data: updatedProduct
      };
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @GetUser() user: any
  ) {
      if (!user.merchant?.id) {
          throw new ForbiddenException('Acesso negado.');
      }
      await this.productService.remove(id, user.merchant.id);
  }
}