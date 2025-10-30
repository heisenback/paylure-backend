// src/deposit/deposit.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DepositService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Simula um depósito. Por enquanto, apenas retorna sucesso.
   * Em uma fase futura, você atualizará o saldo do Merchant.
   */
  async simulateDeposit(userId: string, amount: number) {
    // 🚨 NOTA SÊNIOR: Aqui, você deveria buscar o Merchant pelo userId
    // e atualizar o saldo dele no banco de dados.
    
    // Como estamos pulando etapas, retornamos um mock de sucesso.
    return {
      success: true,
      message: `Depósito de R$ ${amount / 100} simulado com sucesso!`,
      userId: userId,
      transactionId: `TXN-${Date.now()}`,
    };
  }
}