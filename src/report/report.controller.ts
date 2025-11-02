// src/report/report.controller.ts
import { Controller, Get, UseGuards, HttpCode, HttpStatus, Query, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import { ReportService } from './report.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import type { User } from '@prisma/client';

// Rota principal: /api/v1/reports
@Controller('api/v1/reports')
@UseGuards(AuthGuard('jwt')) 
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /**
   * GET /api/v1/reports/summary
   * Retorna as principais métricas de faturamento e volume.
   */
  @Get('summary')
  @HttpCode(HttpStatus.OK)
  async getFinancialSummary(
    @Query() filters: ReportFilterDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      // Retorna 200 OK com dados vazios se não houver merchant
      return { success: true, message: 'Merchant ID não encontrado.', metrics: {} };
    }

    const report = await this.reportService.getSummaryReport(user.merchant.id, filters);

    return {
      success: true,
      message: 'Relatório gerado com sucesso.',
      data: report,
    };
  }

  // Futuro: Rota para Exportar CSV/Excel
}