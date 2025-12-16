// src/product/product.controller.ts
import { 
  Controller, Post, Get, Delete, Patch, Param, Body, 
  UseGuards, HttpStatus, HttpCode, Logger, ForbiddenException, NotFoundException, Query 
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

  @Get('public/:id')
  async findOnePublic(@Param('id') id: string, @Query('offerId') offerId?: string) {
    const product = await this.productService.findById(id);
    if (!product) throw new NotFoundException('Produto indisponível.');

    let finalPrice = product.priceInCents;
    let offerName: string | null = null;

    if (offerId && product.offers) {
        const selectedOffer = product.offers.find(o => o.id === offerId);
        if (selectedOffer) {
            finalPrice = selectedOffer.priceInCents;
            offerName = selectedOffer.name; 
        }
    }
    
    return {
      success: true,
      data: {
        id: product.id,
        title: product.name,
        description: product.description,
        amount: finalPrice, 
        offerName: offerName, 
        checkoutConfig: product.checkoutConfig,
        paymentType: product.paymentType,
        subscriptionPeriod: product.subscriptionPeriod,
        imageUrl: product.imageUrl
      }
    };
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateProductDto, @GetUser() user: any) {
    if (!user.merchant?.id) throw new ForbiddenException('Erro de Perfil.');
    const product = await this.productService.create(dto, user.merchant.id);
    return { success: true, message: 'Produto criado.', data: product };
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async findAll(@GetUser() user: any) {
    if (!user.merchant?.id) throw new ForbiddenException('Usuário não é merchant.');
    const products = await this.productService.findAllByMerchant(user.merchant.id);
    return { success: true, data: this.mapProducts(products) };
  }

  // ✅ NOVA ROTA: CO-PRODUÇÃO
  @Get('coproduction')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async listMyCoProductions(@GetUser() user: any) {
      const products = await this.productService.findMyCoProductions(user.email);
      return { success: true, data: this.mapProducts(products) };
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @GetUser() user: any) {
      // ✅ Passando user.email para validar co-produção
      const updatedProduct = await this.productService.update(id, user.id, user.email, dto);
      return { success: true, message: 'Atualizado com sucesso!', data: updatedProduct };
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: any) {
      if (!user.merchant?.id) throw new ForbiddenException('Acesso negado.');
      await this.productService.remove(id, user.merchant.id);
  }

  // Helper para padronizar retorno
  private mapProducts(products: any[]) {
      return products.map((p) => ({
        id: p.id,
        title: p.name,
        name: p.name,
        description: p.description,
        amount: p.priceInCents,
        price: p.priceInCents / 100,
        imageUrl: p.imageUrl,
        category: p.category,
        deliveryMethod: p.deliveryMethod,
        paymentType: p.paymentType,
        subscriptionPeriod: p.subscriptionPeriod,
        deliveryUrl: p.deliveryUrl,
        fileUrl: p.fileUrl,
        fileName: p.fileName,
        file: p.fileUrl,
        checkoutConfig: p.checkoutConfig,
        offers: p.offers, 
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
      }));
  }
}