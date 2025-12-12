import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  // Rota Pública: POST /api/v1/checkout/pay
  @Post('pay')
  @HttpCode(HttpStatus.OK)
  async pay(@Body() dto: CreatePaymentDto) {
    return await this.checkoutService.processCheckout(dto);
  }
}