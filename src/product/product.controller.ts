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
import { User } from '@prisma/client';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  create(@Body() createProductDto: CreateProductDto, @GetUser() user: User) {
    // Garante que o produto é criado vinculado ao usuário logado
    return this.productService.create(createProductDto, user.merchant?.id || user.id);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  findAll(@GetUser() user: User) {
    // Se for user comum, busca produtos dele. Se tiver merchant, busca pelo merchant.
    const merchantId = user.merchant?.id || user.id;
    return this.productService.findAllByMerchant(merchantId);
  }

  // Rota Pública para o Checkout (Não precisa de Login)
  @Get('public/:id')
  findOnePublic(@Param('id') id: string) {
    return this.productService.findOnePublic(id); // Certifique-se que esse método existe no Service
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  findOne(@Param('id') id: string) {
    return this.productService.findById(id);
  }

  // ✅ AQUI ESTAVA O ERRO DO 403
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  update(
    @Param('id') id: string, 
    @GetUser() user: User, // <--- Pega o usuário do Token
    @Body() updateProductDto: UpdateProductDto
  ) {
    // Passa o ID e o Email para o Service validar se é Dono ou Co-produtor
    return this.productService.update(id, user.id, user.email, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  remove(@Param('id') id: string, @GetUser() user: User) {
    return this.productService.remove(id, user.merchant?.id || user.id);
  }
}