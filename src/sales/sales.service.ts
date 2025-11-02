// src/sales/sales.service.ts
import { Injectable } from '@nestjs/common';
import { TransactionsService } from 'src/transactions/transactions.service';
import { SaleFilterDto } from './dto/sale-filter.dto';
import { Deposit, Withdrawal } from '@prisma/client';

// NOTE: Usaremos o tipo UnifiedTransaction do TransactionsService, mas vamos redefinir aqui
// para evitar erros de dependência circular no NestJS, se necessário.
export type SaleTransaction = {
    id: string;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number;
    status: string;
    date: Date;
    payerEmail?: string;
};


@Injectable()
export class SalesService {
    constructor(private readonly transactionsService: TransactionsService) {}

    /**
     * Busca todas as transações (Depósitos/Saques) para o Merchant e aplica filtros.
     */
    async findAllByMerchant(merchantId: string, filters: SaleFilterDto): Promise<SaleTransaction[]> {
        // O TransactionsService já tem a lógica de buscar e unificar o histórico.
        // Vamos buscar o histórico bruto do Merchant
        const rawHistory = await this.transactionsService.getHistory(merchantId);

        // 🚨 Lógica de Filtro (Simplificada para o Backend)
        let filteredSales: SaleTransaction[] = rawHistory.filter(tx => {
            let pass = true;

            // 1. Filtrar por Status
            if (filters.status && tx.status !== filters.status) {
                pass = false;
            }

            // 2. Filtrar por Data (Simplificado: apenas verifica a data)
            const txDate = new Date(tx.date);
            if (filters.startDate && txDate < new Date(filters.startDate)) {
                pass = false;
            }
            if (filters.endDate && txDate > new Date(filters.endDate)) {
                pass = false;
            }

            // 3. Filtrar por Busca (Email/Documento - Isso exigiria buscar mais dados na transação)
            // Por enquanto, ignoramos o search para manter o TransactionsService simples.

            return pass;
        });

        return filteredSales;
    }
}