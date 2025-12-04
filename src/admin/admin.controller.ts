// src/admin/admin.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Query,
  Param,
  Body,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly systemSettings: SystemSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // ===================================
  // 📊 GET /api/v1/admin/dashboard
  // ===================================
  @Get('dashboard')
  async getDashboard() {
    this.logger.log('[ADMIN] Dashboard acessado');
    return this.adminService.getDashboardStats();
  }

  // ===================================
  // 📈 GET /api/v1/admin/charts/deposits
  // ===================================
  @Get('charts/deposits')
  async getDepositsChart(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : 7;
    this.logger.log(`[ADMIN] Gráfico de depósitos (${daysNum} dias)`);
    return this.adminService.getDepositsChart(daysNum);
  }

  // ===================================
  // 📉 GET /api/v1/admin/charts/withdrawals
  // ===================================
  @Get('charts/withdrawals')
  async getWithdrawalsChart(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : 7;
    this.logger.log(`[ADMIN] Gráfico de saques (${daysNum} dias)`);
    return this.adminService.getWithdrawalsChart(daysNum);
  }

  // ===================================
  // 👥 GET /api/v1/admin/users
  // ===================================
  @Get('users')
  async getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    this.logger.log(`[ADMIN] Listando usuários (página ${pageNum})`);
    return this.adminService.getAllUsers(pageNum, limitNum);
  }

  // ===================================
  // 💰 GET /api/v1/admin/transactions
  // ===================================
  @Get('transactions')
  async getTransactions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: 'DEPOSIT' | 'WITHDRAWAL',
    @Query('status') status?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    this.logger.log(`[ADMIN] Listando transações (página ${pageNum})`);
    return this.adminService.getAllTransactions(pageNum, limitNum, type, status);
  }

  // ===================================
  // 🎯 GET /api/v1/admin/withdrawal-fees
  // Obtém taxas globais de saque
  // ===================================
  @Get('withdrawal-fees')
  async getWithdrawalFees() {
    this.logger.log('[ADMIN] Obtendo taxas globais de saque');
    return await this.systemSettings.getWithdrawalFees();
  }

  // ===================================
  // 🎯 POST /api/v1/admin/withdrawal-fees
  // Define taxas globais de saque
  // ===================================
  @Post('withdrawal-fees')
  @HttpCode(HttpStatus.OK)
  async setWithdrawalFees(
    @Body() body: { percent: number; fixed: number },
  ) {
    this.logger.log(`[ADMIN] Atualizando taxas globais: ${body.percent}% + R$ ${body.fixed}`);
    await this.systemSettings.setWithdrawalFees(body.percent, body.fixed);
    return {
      success: true,
      message: 'Taxas globais atualizadas com sucesso!',
      percent: body.percent,
      fixed: body.fixed,
    };
  }

  // ===================================
  // 🎯 GET /api/v1/admin/users/:userId/withdrawal-fees
  // Obtém taxa de saque de um usuário específico
  // ===================================
  @Get('users/:userId/withdrawal-fees')
  async getUserWithdrawalFees(@Param('userId') userId: string) {
    this.logger.log(`[ADMIN] Obtendo taxas do usuário: ${userId}`);
    
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        withdrawalFeePercent: true,
        withdrawalFeeFixed: true,
      },
    });

    if (!user) {
      return { error: 'Usuário não encontrado' };
    }

    const globalFees = await this.systemSettings.getWithdrawalFees();

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      individual: {
        percent: user.withdrawalFeePercent,
        fixed: user.withdrawalFeeFixed,
        isActive: user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null,
      },
      global: globalFees,
      current: user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null
        ? {
            percent: user.withdrawalFeePercent,
            fixed: user.withdrawalFeeFixed,
            type: 'INDIVIDUAL',
          }
        : {
            percent: globalFees.percent,
            fixed: globalFees.fixed,
            type: 'GLOBAL',
          },
    };
  }

  // ===================================
  // 🎯 PUT /api/v1/admin/users/:userId/withdrawal-fees
  // Define taxa individual de saque para um usuário
  // ===================================
  @Put('users/:userId/withdrawal-fees')
  @HttpCode(HttpStatus.OK)
  async setUserWithdrawalFees(
    @Param('userId') userId: string,
    @Body() body: { percent: number | null; fixed: number | null },
  ) {
    this.logger.log(`[ADMIN] Atualizando taxas do usuário ${userId}: ${body.percent}% + R$ ${body.fixed}`);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        withdrawalFeePercent: body.percent,
        withdrawalFeeFixed: body.fixed,
      },
      select: {
        id: true,
        name: true,
        email: true,
        withdrawalFeePercent: true,
        withdrawalFeeFixed: true,
      },
    });

    return {
      success: true,
      message: body.percent === null
        ? 'Taxa individual removida. Usuário agora usa taxa global.'
        : 'Taxa individual configurada com sucesso!',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        withdrawalFeePercent: user.withdrawalFeePercent,
        withdrawalFeeFixed: user.withdrawalFeeFixed,
      },
    };
  }

  // ===================================
  // 🎯 POST /api/v1/admin/users/:userId/withdrawal-fees/reset
  // Remove taxa individual (volta para taxa global)
  // ===================================
  @HttpCode(HttpStatus.OK)
  @Post('users/:userId/withdrawal-fees/reset')
  async resetUserWithdrawalFees(@Param('userId') userId: string) {
    this.logger.log(`[ADMIN] Removendo taxa individual do usuário ${userId}`);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        withdrawalFeePercent: null,
        withdrawalFeeFixed: null,
      },
    });

    return {
      success: true,
      message: 'Taxa individual removida. Usuário voltou a usar taxa global.',
    };
  }

  // ===================================
  // 🔄 MUDAR SAQUE AUTOMÁTICO/MANUAL (NOVO)
  // ===================================
  @Put('users/:userId/auto-withdrawal')
  @HttpCode(HttpStatus.OK)
  async toggleAutoWithdrawal(
    @Param('userId') userId: string,
    @Body() body: { enabled: boolean }
  ) {
    this.logger.log(`[ADMIN] Alterando saque auto user ${userId} para ${body.enabled}`);
    return this.adminService.toggleAutoWithdrawal(userId, body.enabled);
  }

  // ===================================
  // 💰 GERENCIAR SALDO (NOVO)
  // ===================================
  @Post('users/:userId/balance')
  @HttpCode(HttpStatus.OK)
  async manageBalance(
    @Param('userId') userId: string,
    @Body() body: { type: 'ADD' | 'REMOVE'; amountInCents: number; description?: string }
  ) {
    this.logger.log(`[ADMIN] Gerenciando saldo user ${userId}: ${body.type} ${body.amountInCents}`);
    return this.adminService.manageUserBalance(userId, body.type, body.amountInCents, body.description);
  }
}