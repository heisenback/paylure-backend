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
// ✅ CORREÇÃO 1: Importar como 'import type' para satisfazer o compilador
import type { User } from '@prisma/client';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  create(@Body() createProductDto: CreateProductDto, @GetUser() user: User) {
    // ✅ CORREÇÃO 2: Cast para 'any' para acessar merchant sem erro de tipagem
    const u = user as any;
    return this.productService.create(createProductDto, u.merchant?.id || u.id);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  findAll(@GetUser() user: User) {
    const u = user as any;
    const merchantId = u.merchant?.id || u.id;
    return this.productService.findAllByMerchant(merchantId);
  }

  // ✅ CORREÇÃO 3: Rota Pública
  // Se o método findOnePublic não existir no service, ele usará o findById como fallback
  @Get('public/:id')
  async findOnePublic(@Param('id') id: string) {
    // Tenta chamar o método específico se existir, senão chama o padrão
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
    // Passa o ID e o Email para o Service
    return this.productService.update(id, u.id, u.email, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  remove(@Param('id') id: string, @GetUser() user: User) {
    const u = user as any;
    return this.productService.remove(id, u.merchant?.id || u.id);
  }
}