// src/report/report.controller.ts
import { Controller, Get, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import { ReportService } from './report.service';
import type { User } from '@prisma/client';

@UseGuards(AuthGuard('jwt'))
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  async getFinancialSummary(
    @GetUser() user: User,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // 1. Processa Datas (Default: Últimos 7 dias)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date();
    
    if (!startDate) {
        start.setDate(end.getDate() - 7);
    }

    // Ajusta o horário para cobrir o dia inteiro (00:00:00 até 23:59:59)
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 2. Chama o Serviço passando o ID DO USUÁRIO
    // Usamos user.id porque a tabela Transaction é ligada ao User
    const reportData = await this.reportService.generateReport(user.id, start, end);

    return {
      success: true,
      message: 'Relatório gerado com sucesso.',
      data: reportData, // O frontend espera que os dados estejam dentro de 'data'
    };
  }
}