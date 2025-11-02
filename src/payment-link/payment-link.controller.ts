// src/payment-link/payment-link.controller.ts
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentLinkService } from './payment-link.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

@Controller('payment-links') // 🚨 CORREÇÃO: Usamos o nome base do módulo, o prefixo /api/ será adicionado pelo main.ts
@UseGuards(AuthGuard('jwt'))
export class PaymentLinkController {
    constructor(private readonly paymentLinkService: PaymentLinkService) {}

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @Body() dto: CreatePaymentLinkDto,
        @GetUser() user: User & { merchant?: { id: string } },
    ) {
        if (!user.merchant?.id) {
            throw new Error('Merchant ID não encontrado no usuário.');
        }
        
        // CORREÇÃO: Chama o novo método 'create' do serviço
        return this.paymentLinkService.create(dto, user.merchant.id); 
    }
}