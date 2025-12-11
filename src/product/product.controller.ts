// src/product/product.controller.ts
import { 
  Controller, 
  Post, 
  Get, 
  Delete, // <--- NOVO
  Param,  // <--- NOVO
  Body, 
  UseGuards, 
  HttpStatus, 
  HttpCode, 
  Logger, 
  ForbiddenException,
  NotFoundException // <--- NOVO
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';

@Controller('products')
@UseGuards(AuthGuard('jwt'))
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(private readonly productService: ProductService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateProductDto,
    @GetUser() user: any, 
  ) {
    if (!user.merchant?.id) {
      this.logger.error(`❌ BLOQUEIO: Usuário ${user.email} sem merchant.`);
      throw new ForbiddenException('Erro de Perfil: Produtor não identificado. Faça login novamente.');
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
        description: p.description,
        amount: p.priceInCents / 100,
        isAvailable: p.isAvailable,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    };
  }

  // --- NOVA ROTA DE DELETE ---
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // Retorna 204 (Sucesso sem conteúdo)
  async remove(
    @Param('id') id: string,
    @GetUser() user: any
  ) {
      if (!user.merchant?.id) {
          throw new ForbiddenException('Acesso negado: Merchant ID não encontrado.');
      }

      // Chama o serviço passando o ID do produto E o ID do merchant para garantir que ninguém apague produto dos outros
      await this.productService.remove(id, user.merchant.id);
  }
}