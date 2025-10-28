// src/merchant/merchant.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MerchantService } from './merchant.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';

@Controller('merchant') // O prefixo da rota será /merchant
export class MerchantController {
  constructor(private readonly merchantService: MerchantService) {}

  // Vamos criar a rota POST /merchant
  @UseGuards(AuthGuard('jwt')) // 1. "SEGURANÇA" NA PORTA! (Só logado)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMerchant(@Body() dto: CreateMerchantDto, @Req() req) {
    // 2. Pegamos o ID do usuário que o "segurança" (JwtStrategy)
    // anexou no "req.user"
    const userId = req.user.id;

    // 3. Chamamos o "trabalhador" para criar a loja
    return this.merchantService.createMerchant(dto, userId);
  }
}