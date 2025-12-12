// src/sales/sales.service.ts
import { Injectable } from '@nestjs/common';
import { TransactionsService } from 'src/transactions/transactions.service';

// Interface local para evitar conflitos de tipagem
export interface SaleTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  date: Date;
}

@Injectable()
export class SalesService {
  constructor(private readonly transactionsService: TransactionsService) {}

  /**
   * Método principal de busca (compatível com a lógica nova)
   */
  async getSales(userId: string) {
    return this.fetchAndFilterSales(userId);
  }

  /**
   * ✅ CORREÇÃO: Método adicionado para compatibilidade com o Controller antigo
   * O controller chama: this.salesService.findAllByMerchant(merchantId, filters)
   */
  async findAllByMerchant(merchantId: string, filters?: any) {
    // Redireciona para a mesma lógica de busca. 
    // Nota: O transactionsService espera um ID. Assumindo que merchantId e userId 
    // estão linkados ou que o controller passa o ID correto para busca.
    return this.fetchAndFilterSales(merchantId);
  }

  /**
   * Lógica centralizada para buscar e filtrar apenas Vendas (SALE)
   */
  private async fetchAndFilterSales(id: string) {
    // Busca todo o histórico (Vendas, Depósitos, Saques) via TransactionsService
    const rawHistory = await this.transactionsService.getHistory(id, { 
        page: 1, 
        limit: 100, 
        status: 'ALL' 
    });
    
    // Filtra apenas o que é venda ('SALE') e mapeia para o formato esperado
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