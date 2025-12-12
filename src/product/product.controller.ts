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
  NotFoundException 
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';

@Controller('products')
// 🔓 O bloqueio geral foi removido daqui para permitir a rota pública
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(private readonly productService: ProductService) {}

  // ==================================================================
  // ✅ ROTA PÚBLICA (NOVA)
  // O checkout usa essa rota para carregar dados sem login
  // ==================================================================
  @Get('public/:id')
  async findOnePublic(@Param('id') id: string) {
    const product = await this.productService.findById(id);
    
    if (!product) {
        throw new NotFoundException('Produto não encontrado ou indisponível.');
    }
    
    // Retorna apenas o necessário para o checkout (Segurança)
    return {
      success: true,
      data: {
        id: product.id,
        title: product.name,
        description: product.description,
        amount: product.priceInCents,
        checkoutConfig: product.checkoutConfig 
      }
    };
  }

  // ==================================================================
  // 🔒 ROTAS PROTEGIDAS (DASHBOARD)
  // Exigem login para funcionar
  // ==================================================================

  @Post()
  @UseGuards(AuthGuard('jwt')) // 🔒 Protegido
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
        amount: product.priceInCents, 
        isAvailable: product.isAvailable,
        createdAt: product.createdAt,
      },
    };
  }

  @Get()
  @UseGuards(AuthGuard('jwt')) // 🔒 Protegido
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
        amount: p.priceInCents, 
        isAvailable: p.isAvailable,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        checkoutConfig: p.checkoutConfig
      })),
    };
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt')) // 🔒 Protegido
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @GetUser() user: any
  ) {
      if (!user.merchant?.id) {
          throw new ForbiddenException('Acesso negado: Merchant ID não encontrado.');
      }

      const updatedProduct = await this.productService.update(id, user.merchant.id, dto);

      return {
          success: true,
          message: 'Produto atualizado com sucesso!',
          data: updatedProduct
      };
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt')) // 🔒 Protegido
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @GetUser() user: any
  ) {
      if (!user.merchant?.id) {
          throw new ForbiddenException('Acesso negado: Merchant ID não encontrado.');
      }
      await this.productService.remove(id, user.merchant.id);
  }
}