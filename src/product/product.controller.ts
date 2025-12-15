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
  NotFoundException,
  Query // ✅ Adicionado para ler ?offerId=
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
  // ✅ ROTA PÚBLICA (CHECKOUT) - COM SUPORTE A MULTI-OFERTAS
  // ==================================================================
  @Get('public/:id')
  async findOnePublic(
    @Param('id') id: string,
    @Query('offerId') offerId?: string // ✅ Lê o ID da oferta da URL
  ) {
    const product = await this.productService.findById(id);
    
    if (!product) {
        throw new NotFoundException('Produto não encontrado ou indisponível.');
    }

    // Preço padrão é o do produto principal
    let finalPrice = product.priceInCents;
    let offerName = null;

    // 🎯 SE TIVER OFERTA NA URL, SUBSTITUI O PREÇO
    if (offerId && product.offers) {
        const selectedOffer = product.offers.find(o => o.id === offerId);
        if (selectedOffer) {
            finalPrice = selectedOffer.priceInCents;
            offerName = selectedOffer.name; // Ex: "Plano Anual"
        }
    }
    
    return {
      success: true,
      data: {
        id: product.id,
        title: product.name,
        description: product.description,
        amount: finalPrice, // ✅ Preço Dinâmico (Principal ou Oferta)
        offerName: offerName, // ✅ Nome da oferta (para mostrar no checkout)
        checkoutConfig: product.checkoutConfig,
        paymentType: product.paymentType,
        subscriptionPeriod: product.subscriptionPeriod,
        imageUrl: product.imageUrl
      }
    };
  }

  // ==================================================================
  // ROTAS PROTEGIDAS (DASHBOARD)
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
      data: product,
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

    return {
      success: true,
      data: products.map((p) => ({
        id: p.id,
        title: p.name,
        name: p.name,
        description: p.description,
        amount: p.priceInCents,
        price: p.priceInCents / 100,
        isAvailable: p.isAvailable,
        imageUrl: p.imageUrl,
        category: p.category,
        
        // Configs
        deliveryMethod: p.deliveryMethod,
        paymentType: p.paymentType,
        subscriptionPeriod: p.subscriptionPeriod,
        deliveryUrl: p.deliveryUrl,
        fileUrl: p.fileUrl,
        fileName: p.fileName,
        file: p.fileUrl,
        checkoutConfig: p.checkoutConfig,
        content: p.content,

        // Marketplace e Ofertas
        offers: p.offers, // ✅ Importante para o front listar
        coupons: p.coupons,
        salesPageUrl: p.salesPageUrl,
        isAffiliationEnabled: p.isAffiliationEnabled,
        showInMarketplace: p.showInMarketplace,
        commissionPercent: p.commissionPercent,
        affiliationType: p.affiliationType,
        materialLink: p.materialLink,
        coproductionEmail: p.coproductionEmail,
        coproductionPercent: p.coproductionPercent,
        
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
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