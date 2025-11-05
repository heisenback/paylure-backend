// src/product/product.controller.ts
import { 
  Controller, 
  Post, 
  Get, 
  Body, 
  UseGuards, 
  HttpStatus, 
  HttpCode, 
  Logger, 
  ForbiddenException 
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

@Controller('products')
@UseGuards(AuthGuard('jwt'))
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(private readonly productService: ProductService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateProductDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      this.logger.error(`Tentativa de criar produto sem Merchant ID por ${user.email}`);
      throw new ForbiddenException('Usuário não tem um Merchant ID associado.');
    }

    const product = await this.productService.create(dto, user.merchant.id);

    return {
      success: true,
      message: 'Produto criado com sucesso.',
      data: {
        id: product.id,
        title: product.name,
        description: product.description,
        amount: product.priceInCents / 100,
        isAvailable: product.isAvailable,
        createdAt: product.createdAt,
      },
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      throw new ForbiddenException('Usuário não tem um Merchant ID associado.');
    }

    const products = await this.productService.findAllByMerchant(user.merchant.id);

    const formattedProducts = products.map((p) => ({
      id: p.id,
      title: p.name,
      description: p.description,
      amount: p.priceInCents / 100,
      isAvailable: p.isAvailable,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return {
      success: true,
      data: formattedProducts,
    };
  }
}