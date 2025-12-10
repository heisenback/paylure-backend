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
import { GetUser } from '../auth/decorators/get-user.decorator';

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
  // 📊 DASHBOARD
  // ===================================
  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  // ===================================
  // 📈 GRÁFICOS
  // ===================================
  @Get('charts/deposits')
  async getDepositsChart(@Query('days') days?: string) {
    return this.adminService.getDepositsChart(days ? parseInt(days, 10) : 7);
  }

  @Get('charts/withdrawals')
  async getWithdrawalsChart(@Query('days') days?: string) {
    return this.adminService.getWithdrawalsChart(days ? parseInt(days, 10) : 7);
  }

  // ===================================
  // 👥 USUÁRIOS
  // ===================================
  @Get('users')
  async getUsers(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getAllUsers(page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50);
  }

  @Get('transactions')
  async getTransactions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: 'DEPOSIT' | 'WITHDRAWAL',
    @Query('status') status?: string,
  ) {
    return this.adminService.getAllTransactions(page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 50, type, status);
  }

  // ===================================
  // 🎯 TAXAS
  // ===================================
  @Get('withdrawal-fees')
  async getWithdrawalFees() {
    return await this.systemSettings.getWithdrawalFees();
  }

  @Post('withdrawal-fees')
  @HttpCode(HttpStatus.OK)
  async setWithdrawalFees(@Body() body: { percent: number; fixed: number }) {
    await this.systemSettings.setWithdrawalFees(body.percent, body.fixed);
    return { success: true, message: 'Taxas globais atualizadas!', ...body };
  }

  @Get('users/:userId/withdrawal-fees')
  async getUserWithdrawalFees(@Param('userId') userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { error: 'Usuário não encontrado' };
    const globalFees = await this.systemSettings.getWithdrawalFees();
    return {
      user: { id: user.id, name: user.name, email: user.email },
      individual: { percent: user.withdrawalFeePercent, fixed: user.withdrawalFeeFixed },
      global: globalFees,
    };
  }

  @Put('users/:userId/withdrawal-fees')
  @HttpCode(HttpStatus.OK)
  async setUserWithdrawalFees(@Param('userId') userId: string, @Body() body: { percent: number | null; fixed: number | null }) {
    await this.prisma.user.update({ where: { id: userId }, data: { withdrawalFeePercent: body.percent, withdrawalFeeFixed: body.fixed } });
    return { success: true, message: 'Taxas atualizadas!' };
  }

  @Post('users/:userId/withdrawal-fees/reset')
  @HttpCode(HttpStatus.OK)
  async resetUserWithdrawalFees(@Param('userId') userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { withdrawalFeePercent: null, withdrawalFeeFixed: null } });
    return { success: true, message: 'Taxa resetada para global.' };
  }

  // ===================================
  // 🔄 SAQUE AUTOMÁTICO E SALDO
  // ===================================
  @Put('users/:userId/auto-withdrawal')
  @HttpCode(HttpStatus.OK)
  async toggleAutoWithdrawal(@Param('userId') userId: string, @Body() body: { enabled: boolean }) {
    return this.adminService.toggleAutoWithdrawal(userId, body.enabled);
  }

  @Post('users/:userId/balance')
  @HttpCode(HttpStatus.OK)
  async manageBalance(@Param('userId') userId: string, @Body() body: { type: 'ADD' | 'REMOVE'; amountInCents: number; description?: string }) {
    return this.adminService.manageUserBalance(userId, body.type, body.amountInCents, body.description);
  }

  // ===================================
  // ✅ APROVAR/REJEITAR SAQUE
  // ===================================
  @Post('withdrawals/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveWithdrawal(@Param('id') id: string, @GetUser() admin: any) {
    return this.adminService.approveWithdrawal(id, admin.id);
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectWithdrawal(@Param('id') id: string, @Body() body: { reason: string }, @GetUser() admin: any) {
    return this.adminService.rejectWithdrawal(id, body.reason, admin.id);
  }

  // ===================================
  // 🚩 FEATURE FLAGS (ROTA DO ADMIN)
  // ===================================
  @Get('feature-flags')
  async getFeatureFlags() {
    const flags = await this.adminService.getFeatureFlags();
    return { flags };
  }

  @Post('feature-flags')
  @HttpCode(HttpStatus.OK)
  async updateFeatureFlags(@Body() body: { flags: any }) {
    await this.adminService.updateFeatureFlags(body.flags);
    return { success: true, message: 'Menu atualizado com sucesso!' };
  }
}