// src/marketplace/marketplace.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, ForbiddenException, Query } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { CreateMarketplaceProductDto } from './dto/create-marketplace-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

// Rota principal: /api/v1/marketplace
@Controller('api/v1/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  /**
   * POST /api/v1/marketplace/product
   */
  @Post('product')
  @UseGuards(AuthGuard('jwt')) 
  @HttpCode(HttpStatus.CREATED)
  async addProductToMarketplace(
    @Body() dto: CreateMarketplaceProductDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      throw new ForbiddenException('Usuário não tem um Merchant ID associado.'); 
    }

    dto.merchantId = user.merchant.id;
    const result = await this.marketplaceService.createMarketplaceProduct(dto);

    return {
      success: true,
      message: 'Produto adicionado ao Marketplace com sucesso.',
      data: result,
    };
  }

  /**
   * GET /api/v1/marketplace/products
   */
  @Get('products')
  @HttpCode(HttpStatus.OK)
  async listMarketplaceProducts() {
    // 🚨 CORREÇÃO: Usamos 'findAllAvailable' que foi corrigido para usar 'include'
    const products = await this.marketplaceService.findAllAvailable();

    const formattedProducts = products.map(mp => ({
        ...mp,
        // 🚨 CORREÇÃO TS2551: O acesso a 'product.name' e 'priceInCents' está correto assumindo o include no service.
        productName: mp.product.name, 
        price: mp.product.priceInCents / 100, // Converte para BRL
    }));

    return {
      success: true,
      data: formattedProducts,
    };
  }
}