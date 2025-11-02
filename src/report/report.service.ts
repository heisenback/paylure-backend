// src/report/report.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReportFilterDto } from './dto/report-filter.dto';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. Gera um resumo financeiro e de volume de vendas.
   */
  async getSummaryReport(merchantId: string, filters: ReportFilterDto) {
    const startDate = filters.startDate ? new Date(filters.startDate) : undefined;
    const endDate = filters.endDate ? new Date(filters.endDate) : undefined;

    // A. Contagem de Vendas Aprovadas (Depósitos)
    const salesCount = await this.prisma.deposit.count({
      where: {
        merchantId: merchantId,
        status: 'PAID',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // B. Total de Faturamento Bruto (em centavos)
    const grossRevenue = await this.prisma.deposit.aggregate({
      _sum: {
        amountInCents: true,
      },
      where: {
        merchantId: merchantId,
        status: 'PAID',
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    // C. Total de Comissões Devidas (Simulação: Exige lógica complexa, aqui é 0)
    // NOTA: A lógica real exigiria buscar todos os afiliados, calcular a taxa, e somar.
    const commissionDueInCents = 0; 
    
    // D. Exemplo de performance de Produto (Top 3)
    const topProducts = await this.prisma.deposit.groupBy({
        by: ['paymentLinkId'],
        _count: { id: true },
        where: { merchantId: merchantId, status: 'PAID' },
        orderBy: { _count: { id: 'desc' } },
        take: 3,
    });


    return {
      success: true,
      period: filters,
      metrics: {
        totalSalesVolume: salesCount,
        grossRevenueBRL: (grossRevenue._sum.amountInCents || 0) / 100,
        netRevenueBRL: (grossRevenue._sum.amountInCents || 0) / 100, // Simplificado, idealmente seria gross - fees
        commissionDueBRL: commissionDueInCents / 100,
      },
      topPerformingItems: topProducts,
    };
  }
}