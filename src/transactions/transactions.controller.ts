// src/transactions/transactions.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { TransactionsService } from './transactions.service'; 
import { QuickPixDto } from './dto/quick-pix.dto';
import { GetUser } from 'src/auth/decorators/get-user.decorator'; 
import type { User } from '@prisma/client'; 
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard'; 
import { AuthGuard } from '@nestjs/passport'; 
import { IsNumber, IsString, IsEnum, IsOptional, Min } from 'class-validator'; 

class CreateWithdrawalDto {
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
  async getHistory(
    @GetUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status', new DefaultValuePipe('ALL')) status: string,
    // ✅ ADICIONADO: Recebendo as datas da URL
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!user || !user.id) {
      throw new Error('Usuário autenticado inválido.');
    }
    
    // Passamos as datas para o service
    const historyData = await this.transactionsService.getHistory(user.id, { 
      page, 
      limit, 
      status,
      startDate, // Passando pra frente
      endDate    // Passando pra frente
    });
    
    return {
      success: true,
      data: historyData,
      message: 'Histórico carregado com sucesso'
    };
  }

  @Post('quick-pix')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED) 
  async createQuickPix(
    @Body() dto: QuickPixDto,
    @GetUser() user: User & { merchant: { id: string } },
  ) {
    const merchantId = user.merchant?.id;
    if (!merchantId) {
        throw new Error('Merchant ID não encontrado para este usuário.');
    }
    
    const { deposit, pixCode } = await this.transactionsService.createQuickPix(
      user.id,
      merchantId,
      dto,
    );
    
    return {
      success: true,
      message: 'PIX gerado com sucesso.',
      depositId: deposit.id,
      amount: deposit.amountInCents / 100, 
      pixCode: pixCode,
    };
  }

  @Post('/withdrawals')
  @UseGuards(AuthGuard('jwt'))
  async createWithdrawal(@Body() dto: CreateWithdrawalDto, @GetUser() user: User) {
      return await this.transactionsService.createWithdrawal(user.id, dto);
  }
}