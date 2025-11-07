// src/transactions/transactions.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, Query, Param, NotFoundException } from '@nestjs/common';
import { TransactionsService, WithdrawalDto } from './transactions.service'; 
import { QuickPixDto } from './dto/quick-pix.dto';
import { GetUser } from 'src/auth/decorators/get-user.decorator'; 
import type { User } from '@prisma/client'; 
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard'; 
import { AuthGuard } from '@nestjs/passport'; 
import { IsNumber, IsString, IsEnum, IsOptional, Min } from 'class-validator'; 

class CreateWithdrawalDto implements WithdrawalDto {
    @IsNumber() @Min(0.01) amount: number;
    @IsString() pixKey: string;
    @IsEnum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM']) keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
    @IsString() @IsOptional() description?: string;
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('history')
  @UseGuards(AuthGuard('jwt'))
  async getHistory(@GetUser() user: User) {
    if (!user || !user.id) {
      throw new Error('Usuário autenticado, mas o ID do usuário está faltando no Token.');
    }
    
    return this.transactionsService.getHistory(user.id);
  }

  @Post('quick-pix')
  @UseGuards(ApiKeyGuard) 
  @HttpCode(HttpStatus.CREATED) 
  async createQuickPix(
    @Body() dto: QuickPixDto,
    @GetUser() user: User & { merchant: { id: string } },
  ) {
    if (!user.merchant?.id) {
        throw new Error('Usuário autenticado sem um Merchant ID associado.');
    }
    
    const { deposit, pixCode } = await this.transactionsService.createQuickPix(
      user.id,
      user.merchant.id,
      dto,
    );
    
    return {
      success: true,
      message: 'PIX avulso gerado com sucesso.',
      depositId: deposit.id,
      amount: deposit.amountInCents / 100, 
      pixCode: pixCode,
      qrCodeUrl: `https://seu-dominio.com/qrcode-generator?pix=${pixCode}`,
      expiresInSeconds: 3600, 
    };
  }
}