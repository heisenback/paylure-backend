// src/transactions/transactions.controller.ts
import { 
  Controller, 
  Post, 
  Body, 
  UseGuards, 
  Get, 
  HttpCode, 
  HttpStatus, 
  Query, 
  ParseIntPipe, 
  DefaultValuePipe,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { TransactionsService, WithdrawalDto } from './transactions.service'; 
import { QuickPixDto } from './dto/quick-pix.dto';
import { GetUser } from 'src/auth/decorators/get-user.decorator'; 
import type { User } from '@prisma/client'; 
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard'; 
import { AuthGuard } from '@nestjs/passport'; 
import { IsNumber, IsString, IsEnum, IsOptional, Min } from 'class-validator'; 

class CreateWithdrawalDto implements WithdrawalDto {
    @IsNumber() 
    @Min(0.01) 
    amount: number;
    
    @IsString() 
    pixKey: string;
    
    @IsEnum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM']) 
    keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
    
    @IsString() 
    @IsOptional() 
    description?: string;
}

@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(private readonly transactionsService: TransactionsService) {}

  // ===================================
  // 🚀 HISTÓRICO COM FILTROS E PAGINAÇÃO
  // ===================================
  @Get('history')
  @UseGuards(AuthGuard('jwt'))
  async getHistory(
    @GetUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status', new DefaultValuePipe('ALL')) status: string,
  ) {
    // 🎯 Validação de usuário
    if (!user || !user.id) {
      this.logger.error('❌ Usuário autenticado sem ID no token');
      throw new BadRequestException('Usuário autenticado, mas o ID do usuário está faltando no Token.');
    }

    // 🎯 Validação de parâmetros
    if (page < 1) {
      throw new BadRequestException('A página deve ser maior ou igual a 1');
    }
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('O limite deve estar entre 1 e 100');
    }

    // 🎯 Validação de status
    const validStatuses = ['ALL', 'PENDING', 'CONFIRMED', 'COMPLETED', 'FAILED'];
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new BadRequestException(`Status inválido. Use: ${validStatuses.join(', ')}`);
    }

    this.logger.log(`📊 Buscando histórico: userId=${user.id}, page=${page}, limit=${limit}, status=${status}`);
    
    const options = { page, limit, status: status.toUpperCase() };
    const historyData = await this.transactionsService.getHistory(user.id, options);
    
    // 🎯 Retorna no formato que o frontend (page.tsx) espera
    return {
      success: true,
      data: historyData, // { transactions: [...], pagination: {...} }
      message: `${historyData.pagination.totalItems} transação(ões) encontrada(s)`
    };
  }

  // ===================================
  // 💳 QUICK PIX (PIX AVULSO)
  // ===================================
  @Post('quick-pix')
  @UseGuards(ApiKeyGuard) 
  @HttpCode(HttpStatus.CREATED) 
  async createQuickPix(
    @Body() dto: QuickPixDto,
    @GetUser() user: User & { merchant: { id: string } },
  ) {
    // 🎯 Validação de merchant
    if (!user.merchant?.id) {
      this.logger.error(`❌ Usuário ${user.id} sem Merchant ID associado`);
      throw new BadRequestException('Usuário autenticado sem um Merchant ID associado.');
    }

    // 🎯 Validação do valor
    if (dto.amount < 1) {
      throw new BadRequestException('O valor mínimo para gerar um PIX é R$ 1,00');
    }

    this.logger.log(`💳 Gerando Quick PIX: userId=${user.id}, merchantId=${user.merchant.id}, valor=R$ ${dto.amount}`);
    
    const { deposit, pixCode } = await this.transactionsService.createQuickPix(
      user.id,
      user.merchant.id,
      dto,
    );

    this.logger.log(`✅ Quick PIX gerado com sucesso: depositId=${deposit.id}`);
    
    return {
      success: true,
      message: 'PIX avulso gerado com sucesso.',
      data: {
        depositId: deposit.id,
        amount: deposit.amountInCents / 100, 
        amountInCents: deposit.amountInCents,
        pixCode: pixCode,
        qrCodeUrl: `https://api.paylure.com.br/qrcode/${deposit.id}`, // 🎯 URL melhorada
        expiresInSeconds: 3600,
        status: deposit.status,
        createdAt: deposit.createdAt,
      }
    };
  }
}