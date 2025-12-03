// src/sales/sales.service.ts
import { Injectable } from '@nestjs/common';
import { TransactionsService } from 'src/transactions/transactions.service';
import { SaleFilterDto } from './dto/sale-filter.dto';

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
     * 🎯 CORREÇÃO: Adiciona os parâmetros obrigatórios para getHistory
     */
    async findAllByMerchant(merchantId: string, filters: SaleFilterDto): Promise<SaleTransaction[]> {
        // Busca o histórico com os parâmetros corretos
        const options = {
            page: 1,
            limit: 1000, // Busca tudo para depois filtrar
            status: 'ALL'
        };
        
        const rawHistory = await this.transactionsService.getHistory(merchantId, options);

        // 🎯 CORREÇÃO: Acessa o array de transactions corretamente
        let filteredSales: SaleTransaction[] = rawHistory.transactions.map(tx => ({
            id: tx.id,
            type: tx.type,
            amount: tx.amountInCents / 100, // Converte centavos para reais
            status: tx.status,
            date: tx.createdAt,
        })).filter(tx => {
            let pass = true;

            // 1. Filtrar por Status
            if (filters.status && tx.status !== filters.status) {
                pass = false;
            }

            // 2. Filtrar por Data
            const txDate = new Date(tx.date);
            if (filters.startDate && txDate < new Date(filters.startDate)) {
                pass = false;
            }
            if (filters.endDate && txDate > new Date(filters.endDate)) {
                pass = false;
            }

            return pass;
        });

        return filteredSales;
    }
}