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
  create(
    @Body() createProductDto: CreateProductDto, 
    @GetUser() user: User
  ) {
    const u = user as any;
    return this.productService.create(createProductDto, u.id);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  findAll(@GetUser() user: User) {
    const u = user as any;
    return this.productService.findAllByUser(u.id);
  }

  @Get('public/:id')
  findOnePublic(@Param('id') id: string) {
    return this.productService.findOnePublic(id);
  }

  // ✅ ROTA DE CO-PRODUÇÃO PRECISA VIR ANTES DO :id
  @Get('coproduction')
  @UseGuards(AuthGuard('jwt'))
  findCopro(@GetUser() user: User) {
    const u = user as any;
    return this.productService.findMyCoProductions(u.email);
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
    return this.productService.update(id, u.id, u.email, updateProductDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  remove(@Param('id') id: string, @GetUser() user: User) {
    const u = user as any;
    return this.productService.remove(id, u.id);
  }
}
