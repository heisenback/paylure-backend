// src/product/product.controller.ts
import { 
  Controller, Get, Post, Body, Patch, Param, Delete, 
  UseGuards, HttpCode, HttpStatus, Query 
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(@Body() createProductDto: CreateProductDto, @GetUser() user: User) {
    const u = user as any;
    // ✅ CORREÇÃO: Busca o Merchant ID real no banco
    const merchantId = await this.productService.getMerchantId(u.id);
    return this.productService.create(createProductDto, merchantId);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async findAll(@GetUser() user: User) {
    const u = user as any;
    // ✅ CORREÇÃO: Busca o Merchant ID real no banco. Isso trará seus produtos de volta!
    const merchantId = await this.productService.getMerchantId(u.id);
    return this.productService.findAllByMerchant(merchantId);
  }

  @Get('public/:id')
  async findOnePublic(@Param('id') id: string) {
    if ((this.productService as any).findOnePublic) {
        return (this.productService as any).findOnePublic(id);
    }
    return this.productService.findById(id);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  findOne(@Param('id') id: string) {
    return this.productService.findById(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  update(
    @Param('id') id: string, 
    @GetUser() user: User, 
    @Body() updateProductDto: UpdateProductDto
  ) {
    const u = user as any;
    // Passa o ID e Email para o service validar (Service agora resolve o Merchant ID sozinho)
    return this.productService.update(id, u.id, u.email, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async remove(@Param('id') id: string, @GetUser() user: User) {
    const u = user as any;
    const merchantId = await this.productService.getMerchantId(u.id);
    return this.productService.remove(id, merchantId);
  }
}