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

@Controller('public')
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  private readonly logger = new Logger(PublicApiController.name);

  constructor(
    private readonly depositService: DepositService,
    private readonly withdrawalService: WithdrawalService,
    private readonly transactionsService: TransactionsService,
    private readonly productService: ProductService,
  ) {}

  @Post('deposits')
  @HttpCode(HttpStatus.CREATED)
  async createDeposit(
    @Body() dto: CreateDepositDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    this.logger.log(`[API Pública] Depósito solicitado por: ${user.email}`);
    
    const normalizedDto = {
      amount: Number(dto.amount),
      payerName: (dto.payerName || dto.userName || 'Usuário da Gateway').trim(),
      payerEmail: (dto.payerEmail || dto.userEmail || '').trim(),
      payerDocument: (dto.payerDocument || dto.userDocument || '').replace(/\D/g, ''),
      phone: (dto.payerPhone || dto.phone || '').replace(/\D/g, '') || undefined,
      externalId: dto.externalId,
      callbackUrl: dto.callbackUrl,
    };

    const result = await this.depositService.createDeposit(user.id, normalizedDto);
    
    return {
      success: true,
      message: result.message || 'Depósito criado com sucesso.',
      data: {
        pixCode: result.qrcode,
        depositId: result.transactionId,
        amount: result.amount,
        status: result.status,
      },
    };
  }

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
        amount: dto.amount / 100,
      },
    };
  }

  /**
   * 🎯 CORREÇÃO: Adiciona os parâmetros obrigatórios para getHistory
   */
  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  async getTransactions(
    @GetUser() user: User,
  ) {
    this.logger.log(`[API Pública] Histórico solicitado por: ${user.email}`);
    
    // Passa os parâmetros necessários
    const options = {
      page: 1,
      limit: 100,
      status: 'ALL'
    };
    
    const history = await this.transactionsService.getHistory(user.id, options);
    
    return {
      success: true,
      data: history,
    };
  }

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
      amount: p.priceInCents / 100,
      isAvailable: p.isAvailable,
      createdAt: p.createdAt,
    }));

    return {
      success: true,
      data: formattedProducts,
    };
  }

  @Get('balance')
  @HttpCode(HttpStatus.OK)
  async getBalance(
    @GetUser() user: User,
  ) {
    this.logger.log(`[API Pública] Saldo solicitado por: ${user.email}`);
    
    return {
      success: true,
      data: {
        balance: user.balance / 100,
        balanceInCents: user.balance,
      },
    };
  }

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