// src/transactions/transactions.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, Query, Param, NotFoundException } from '@nestjs/common';
import { TransactionsService, WithdrawalDto } from './transactions.service'; 
import { QuickPixDto } from './dto/quick-pix.dto';
import { GetUser } from 'src/auth/decorators/get-user.decorator'; 
import type { User } from '@prisma/client'; 
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard'; 
import { AuthGuard } from '@nestjs/passport'; 
import { IsNumber, IsString, IsEnum, IsOptional, Min } from 'class-validator'; 

// DTO de Saque (Mantido)
class CreateWithdrawalDto implements WithdrawalDto {
    @IsNumber() @Min(0.01) amount: number;
    @IsString() pixKey: string;
    @IsEnum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM']) keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
    @IsString() @IsOptional() description?: string;
}

// 💡 Rota Principal: /api/v1/transactions
@Controller('api/v1/transactions') 
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // --- 🚨 🚨 🚨 NOVO MÉTODO ADICIONADO AQUI 🚨 🚨 🚨 ---
  /**
   * GET /api/v1/transactions/history
   * Busca o histórico de transações (depósitos e saques) do usuário logado.
   */
  @Get('history')
  @UseGuards(AuthGuard('jwt')) // Protege a rota, assim como o frontend espera
  async getHistory(@GetUser() user: User) {
    if (!user || !user.id) {
      throw new Error('Usuário autenticado, mas o ID do usuário está faltando no Token.');
    }
    
    // Agora chamamos o serviço (que será nosso próximo erro)
    return this.transactionsService.getHistory(user.id);
  }
  // --- FIM DO NOVO MÉTODO ---


  /**
   * POST /api/v1/transactions/quick-pix
   */
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