// src/transactions/transactions.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, Query, Param, NotFoundException, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
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

  // ===================================
  // 🚀 CORREÇÃO APLICADA AQUI (FILTROS E PAGINAÇÃO)
  // ===================================
  @Get('history')
  @UseGuards(AuthGuard('jwt'))
  async getHistory(
    @GetUser() user: User,
    // 🎯 Adiciona Query Params para filtro e paginação
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status', new DefaultValuePipe('ALL')) status: string,
  ) {
    if (!user || !user.id) {
      throw new Error('Usuário autenticado, mas o ID do usuário está faltando no Token.');
    }
    
    const options = { page, limit, status };
    const historyData = await this.transactionsService.getHistory(user.id, options);
    
    // 🎯 Retorna no formato que o frontend (page.tsx) espera
    return {
      success: true,
      data: historyData, // { transactions: [...], pagination: {...} }
      message: `${historyData.pagination.totalItems} transações encontradas`
    };
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