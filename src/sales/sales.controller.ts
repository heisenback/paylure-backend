// src/sales/sales.controller.ts
import { Controller, Get, UseGuards, HttpCode, HttpStatus, Query, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import { SalesService } from './sales.service';
import { SaleFilterDto } from './dto/sale-filter.dto';
import type { User } from '@prisma/client';

// Rota principal: /api/v1/sales
@Controller('sales')
@UseGuards(AuthGuard('jwt')) 
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * GET /api/v1/sales
   * Retorna todas as transações (Depósitos e Saques) para o Merchant, com filtros.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async listSales(
    @Query() filters: SaleFilterDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      throw new ForbiddenException('Acesso negado. O usuário não está associado a um Merchant.');
    }

    const sales = await this.salesService.findAllByMerchant(user.merchant.id, filters);

    return {
      success: true,
      data: sales,
    };
  }
}
