// src/checkout/checkout.controller.ts
import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('pay')
  @HttpCode(HttpStatus.OK)
  async pay(@Body() dto: CreatePaymentDto) {
    return await this.checkoutService.processCheckout(dto);
  }

  // ✅ ROTA QUE FALTAVA PARA O POLLING FUNCIONAR
  @Get('status/:id')
  async checkStatus(@Param('id') id: string) {
    return await this.checkoutService.checkTransactionStatus(id);
  }
}