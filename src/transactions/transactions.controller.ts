// src/transactions/transactions.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { TransactionsService, WithdrawalDto } from './transactions.service'; 
import { QuickPixDto } from './dto/quick-pix.dto';
import { GetUser } from 'src/auth/decorators/get-user.decorator'; 
import type { User } from '@prisma/client'; 
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard'; 
import { AuthGuard } from '@nestjs/passport'; 
import { IsNumber, IsString, IsEnum, IsOptional, Min } from 'class-validator'; 

// DTO Local para validação do saque (se não estiver em arquivo separado)
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
  ) {
    if (!user || !user.id) {
      throw new Error('Usuário autenticado inválido.');
    }
    
    // Chama o serviço que agora busca na tabela unificada 'Transaction'
    const historyData = await this.transactionsService.getHistory(user.id, { page, limit, status });
    
    return {
      success: true,
      data: historyData,
      message: 'Histórico carregado com sucesso'
    };
  }

  @Post('quick-pix')
  @UseGuards(ApiKeyGuard) // Ou AuthGuard('jwt') dependendo de onde chama
  @HttpCode(HttpStatus.CREATED) 
  async createQuickPix(
    @Body() dto: QuickPixDto,
    @GetUser() user: User & { merchant: { id: string } },
  ) {
    // Se o usuário logado tiver merchant, usa. Se não, erro.
    const merchantId = user.merchant?.id;
    if (!merchantId) {
        // Fallback: se for usuário comum sem merchant, talvez não possa gerar quick pix
        // Ou crie uma lógica para buscar um merchant default.
        // Assumindo que quem gera tem merchant:
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

  @Post('/withdrawals') // Caso sua rota seja /transactions/withdrawals ou similar
  @UseGuards(AuthGuard('jwt'))
  async createWithdrawal(@Body() dto: CreateWithdrawalDto, @GetUser() user: User) {
      return await this.transactionsService.createWithdrawal(user.id, dto);
  }
}