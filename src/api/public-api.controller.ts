// src/api/public-api.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import { DepositService } from 'src/deposit/deposit.service';
import { WithdrawalService } from 'src/withdrawal/withdrawal.service';
import { TransactionsService } from 'src/transactions/transactions.service';
import { ProductService } from 'src/product/product.service';
import { CreateDepositDto } from 'src/deposit/dto/create-deposit.dto';
import { CreateWithdrawalDto } from 'src/withdrawal/dto/create-withdrawal.dto';
import type { User } from '@prisma/client';

/**
 * Controller de API Pública.
 * 
 * Endpoints para integração externa usando Client ID/Secret.
 * Rota base: /api/public/*
 * 
 * Autenticação:
 * Authorization: ApiKey client_id:client_secret
 */
@Controller('public')
@UseGuards(ApiKeyGuard) // ⭐ Todas as rotas exigem API Key
export class PublicApiController {
  private readonly logger = new Logger(PublicApiController.name);

  constructor(
    private readonly depositService: DepositService,
    private readonly withdrawalService: WithdrawalService,
    private readonly transactionsService: TransactionsService,
    private readonly productService: ProductService,
  ) {}

  /**
   * POST /api/public/deposits
   * Cria um novo depósito (PIX)
   */
  @Post('deposits')
  @HttpCode(HttpStatus.CREATED)
  async createDeposit(
    @Body() dto: CreateDepositDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    this.logger.log(`[API Pública] Depósito solicitado por: ${user.email}`);
    
    const result = await this.depositService.createDeposit(user.id, dto);
    
    return {
      success: true,
      message: 'Depósito criado com sucesso.',
      data: {
        pixCode: result.pixCode,
        depositId: result.depositId,
        amount: dto.amount / 100, // Retorna em BRL
      },
    };
  }

  /**
   * POST /api/public/withdrawals
   * Solicita um saque
   */
  @Post('withdrawals')
  @HttpCode(HttpStatus.CREATED)
  async createWithdrawal(
    @Body() dto: CreateWithdrawalDto,
    @GetUser() user: User,
  ) {
    this.logger.log(`[API Pública] Saque solicitado por: ${user.email}`);
    
    const result = await this.withdrawalService.create(user, dto);
    
    return {
      success: true,
      message: result.message,
      data: {
        transactionId: result.transactionId,
        amount: dto.amount / 100, // Retorna em BRL
      },
    };
  }

  /**
   * GET /api/public/transactions
   * Lista o histórico de transações
   */
  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  async getTransactions(
    @GetUser() user: User,
  ) {
    this.logger.log(`[API Pública] Histórico solicitado por: ${user.email}`);
    
    const history = await this.transactionsService.getHistory(user.id);
    
    return {
      success: true,
      data: history,
    };
  }

  /**
   * GET /api/public/products
   * Lista os produtos do merchant
   */
  @Get('products')
  @HttpCode(HttpStatus.OK)
  async getProducts(
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      return {
        success: true,
        data: [],
        message: 'Usuário não possui merchant associado.',
      };
    }

    this.logger.log(`[API Pública] Produtos solicitados por: ${user.email}`);
    
    const products = await this.productService.findAllByMerchant(user.merchant.id);
    
    const formattedProducts = products.map((p) => ({
      id: p.id,
      title: p.name,
      description: p.description,
      amount: p.priceInCents / 100, // Retorna em BRL
      isAvailable: p.isAvailable,
      createdAt: p.createdAt,
    }));

    return {
      success: true,
      data: formattedProducts,
    };
  }

  /**
   * GET /api/public/balance
   * Consulta o saldo disponível
   */
  @Get('balance')
  @HttpCode(HttpStatus.OK)
  async getBalance(
    @GetUser() user: User,
  ) {
    this.logger.log(`[API Pública] Saldo solicitado por: ${user.email}`);
    
    return {
      success: true,
      data: {
        balance: user.balance / 100, // Retorna em BRL
        balanceInCents: user.balance,
      },
    };
  }

  /**
   * GET /api/public/me
   * Retorna informações do usuário autenticado
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(
    @GetUser() user: User & { merchant?: any },
  ) {
    const { password, apiSecret, ...safeUser } = user;
    
    return {
      success: true,
      data: {
        user: safeUser,
      },
    };
  }
}