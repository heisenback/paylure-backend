// src/report/report.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateReport(userId: string, startDate: Date, endDate: Date) {
    // 1. Definições de Filtro de Data
    const dateFilter: Prisma.DateTimeFilter = {
      gte: startDate,
      lte: endDate,
    };

    // Status considerados como "Venda Aprovada"
    const statusPaid = { in: ['PAID', 'CONFIRMED', 'COMPLETED', 'APPROVED'] };

    // =================================================================
    // 2. BUSCA DE DADOS (USANDO TABELA TRANSACTION PARA UNIFICAR TUDO)
    // =================================================================
    
    // A. Busca todas as transações aprovadas (VENDAS REAIS)
    const approvedSales = await this.prisma.transaction.findMany({
      where: {
        userId,
        createdAt: dateFilter,
        type: { in: ['SALE', 'DEPOSIT'] }, // Considera vendas e depósitos
        status: statusPaid,
      },
      include: { 
        product: {
            select: { id: true, name: true }
        } 
      }
    });

    // B. Busca todas as tentativas (Para cálculo de conversão - CHECKOUTS/PIX GERADOS)
    const totalAttempts = await this.prisma.transaction.count({
      where: {
        userId,
        createdAt: dateFilter,
        type: { in: ['SALE', 'DEPOSIT'] },
      },
    });

    // =================================================================
    // 3. CÁLCULOS DE KPI (MÉTRICAS)
    // =================================================================

    // Faturamento Bruto (Soma dos cents)
    const grossRevenueCents = approvedSales.reduce((acc, tx) => acc + tx.amount, 0);
    
    // Receita Líquida (Simulação: Bruto - 4.99% de taxa - R$ 1,00 fixo)
    // *No futuro, você pode pegar a taxa real do cadastro do usuário (user.withdrawalFeePercent)*
    const netRevenueCents = approvedSales.reduce((acc, tx) => {
        const fee = Math.round(tx.amount * 0.0499) + 100; // 4.99% + 100 cents (R$1)
        return acc + (tx.amount - fee);
    }, 0);

    const totalSalesVolume = approvedSales.length;
    
    // Ticket Médio
    const averageTicket = totalSalesVolume > 0 ? Math.round(grossRevenueCents / totalSalesVolume) : 0;
    
    // Taxa de Conversão (Pagos / Tentativas)
    const conversionRate = totalAttempts > 0 
        ? (totalSalesVolume / totalAttempts) * 100 
        : 0;

    // =================================================================
    // 4. PREPARAÇÃO DO GRÁFICO DIÁRIO (ÁREA CHART)
    // =================================================================
    const dailyMap = new Map<string, number>();
    
    // Preenche o mapa com TODOS os dias do intervalo com valor 0 (para o gráfico não ficar buracado)
    const tempDate = new Date(startDate);
    while (tempDate <= endDate) {
        const dayStr = tempDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); // Ex: "12/12"
        dailyMap.set(dayStr, 0);
        tempDate.setDate(tempDate.getDate() + 1);
    }

    // Soma os valores reais nas datas corretas
    approvedSales.forEach(tx => {
        const dayStr = new Date(tx.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        // Se a data estiver no range (pode haver timezone edge cases), soma
        if (dailyMap.has(dayStr)) {
            const current = dailyMap.get(dayStr) || 0;
            dailyMap.set(dayStr, current + tx.amount);
        }
    });

    // Converte para o array que o Recharts espera
    const dailyData = Array.from(dailyMap.entries()).map(([date, value]) => ({
        date,
        value: value / 100 // Converte centavos para Reais (float) para o gráfico ficar bonito
    }));

    // =================================================================
    // 5. TOP PRODUTOS (RANKING)
    // =================================================================
    const productMap = new Map<string, { name: string, sales: number, revenue: number }>();

    approvedSales.forEach(tx => {
        // Se a transação tem produto atrelado ou uma descrição
        const prodId = tx.product?.id || 'unknown';
        const prodName = tx.product?.name || tx.description || 'Produto Genérico';

        const current = productMap.get(prodId) || { name: prodName, sales: 0, revenue: 0 };
        current.sales += 1;
        current.revenue += tx.amount;
        productMap.set(prodId, current);
    });

    const topProducts = Array.from(productMap.values())
        .sort((a, b) => b.revenue - a.revenue) // Ordena por maior receita
        .slice(0, 5); // Pega só os top 5

    // =================================================================
    // 6. MÉTODOS DE PAGAMENTO (PIE CHART)
    // =================================================================
    const paymentMap = new Map<string, number>();
    approvedSales.forEach(tx => {
        const rawMethod = tx.paymentMethod || 'PIX'; 
        // Formata nome bonito
        const label = rawMethod === 'CREDIT_CARD' ? 'Cartão' : (rawMethod === 'BOLETO' ? 'Boleto' : 'Pix');
        paymentMap.set(label, (paymentMap.get(label) || 0) + 1);
    });

    const paymentData = Array.from(paymentMap.entries()).map(([name, value]) => ({ name, value }));

    // =================================================================
    // 7. RETORNO FINAL (NO FORMATO QUE O PAGE.TSX ESPERA)
    // =================================================================
    return {
        metrics: {
            totalSalesVolume,
            grossRevenueBRL: grossRevenueCents, // Frontend formata divide por 100
            netRevenueBRL: netRevenueCents,
            averageTicket: averageTicket,
            refundsTotal: 0, 
            totalOrdersCreated: totalAttempts,
            conversionRate
        },
        daily: dailyData,
        topProducts,
        paymentMethods: paymentData
    };
  }
}