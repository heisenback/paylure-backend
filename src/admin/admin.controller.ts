// src/admin/admin.controller.ts
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard) // 🔒 Protegido: Requer login + ser admin
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(private readonly adminService: AdminService) {}

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
}