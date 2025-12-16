// src/product/product.controller.ts
import { 
  Controller, Get, Post, Body, Patch, Param, Delete, 
  UseGuards
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
  create(@Body() createProductDto: CreateProductDto, @GetUser() user: User) {
    const u = user as any;
    // Passa o ID do usuário, o Service resolve se usa Merchant ou UserID
    return this.productService.create(createProductDto, u.id);
  }

  // ✅ AQUI ESTÁ A MÁGICA PARA OS PRODUTOS VOLTAREM
  @Get()
  @UseGuards(AuthGuard('jwt'))
  findAll(@GetUser() user: User) {
    const u = user as any;
    // Chama o método novo que procura em todas as gavetas
    return this.productService.findAllByUser(u.id);
  }

  @Get('public/:id')
  findOnePublic(@Param('id') id: string) {
    return this.productService.findOnePublic(id);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  findOne(@Param('id') id: string) {
    return this.productService.findById(id);
  }

  @Get('coproduction')
  @UseGuards(AuthGuard('jwt'))
  findCopro(@GetUser() user: User) {
      const u = user as any;
      return this.productService.findMyCoProductions(u.email);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  update(
    @Param('id') id: string, 
    @GetUser() user: User, 
    @Body() updateProductDto: UpdateProductDto
  ) {
    const u = user as any;
    return this.productService.update(id, u.id, u.email, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  remove(@Param('id') id: string, @GetUser() user: User) {
    const u = user as any;
    return this.productService.remove(id, u.id);
  }
}