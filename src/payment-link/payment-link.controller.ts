// src/payment-link/payment-link.controller.ts
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
import { PaymentLinkService } from './payment-link.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';

// Define o prefixo da rota para /payment-links
@Controller('payment-links')
export class PaymentLinkController {
  constructor(private readonly paymentLinkService: PaymentLinkService) {}

  // Vamos criar a rota POST /payment-links
  @UseGuards(AuthGuard('jwt')) // 1. "SEGURANÇA" NA PORTA! (Só logado)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPaymentLink(@Body() dto: CreatePaymentLinkDto, @Req() req) {
    // 2. Pegamos o ID do usuário que o "segurança" (JwtStrategy)
    // anexou no "req.user"
    const userId = req.user.id;

    // 3. Chamamos o "trabalhador" para criar o link
    return this.paymentLinkService.createPaymentLink(dto, userId);
  }
}