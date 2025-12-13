// src/sales/sales.service.ts
import { Injectable } from '@nestjs/common';
import { TransactionsService } from 'src/transactions/transactions.service';

// Interface local para evitar conflitos de tipagem
export interface SaleTransaction {
  id: string;
  type: string;
  amountInCents: number; // Mudei de amount para amountInCents
  status: string;
  date: Date;
}

@Injectable()
export class SalesService {
  constructor(private readonly transactionsService: TransactionsService) {}

  async getSales(userId: string) {
    return this.fetchAndFilterSales(userId);
  }

  async findAllByMerchant(merchantId: string, filters?: any) {
    return this.fetchAndFilterSales(merchantId);
  }

  private async fetchAndFilterSales(id: string) {
    const rawHistory = await this.transactionsService.getHistory(id, { 
        page: 1, 
        limit: 100, 
        status: 'ALL' 
    });
    
    const filteredSales: SaleTransaction[] = rawHistory.transactions
        .filter((t: any) => t.type === 'SALE') 
        .map((tx: any) => ({
            id: tx.id,
            type: tx.type,
            amountInCents: tx.amountInCents, // Mudei aqui para garantir que o front receba o nome certo
            status: tx.status,
            date: new Date(tx.createdAt) 
        }));

    return filteredSales;
  }
}