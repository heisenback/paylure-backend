// src/sales/sales.service.ts
import { Injectable } from '@nestjs/common';
import { TransactionsService } from 'src/transactions/transactions.service';

// ✅ CORREÇÃO: Definimos um tipo local flexível para evitar conflito
export interface SaleTransaction {
  id: string;
  type: string; // Agora aceita 'SALE', 'DEPOSIT', 'WITHDRAWAL', etc.
  amount: number;
  status: string;
  date: Date;
}

@Injectable()
export class SalesService {
  constructor(private readonly transactionsService: TransactionsService) {}

  async getSales(userId: string) {
    // Busca todo o histórico (Vendas, Depósitos, Saques)
    const rawHistory = await this.transactionsService.getHistory(userId, { 
        page: 1, 
        limit: 100, 
        status: 'ALL' 
    });
    
    // ✅ CORREÇÃO: Mapeamento seguro que satisfaz o TypeScript
    // Filtramos apenas o que é venda ('SALE') para garantir a integridade
    const filteredSales: SaleTransaction[] = rawHistory.transactions
        .filter((t: any) => t.type === 'SALE') 
        .map((tx: any) => ({
            id: tx.id,
            type: tx.type,
            amount: tx.amountInCents, // Ajuste para o campo correto
            status: tx.status,
            date: new Date(tx.createdAt) // Garante que seja objeto Date
        }));

    return filteredSales;
  }
}