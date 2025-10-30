// src/deposit/deposit.controller.ts

import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { DepositService } from './deposit.service';
import { AuthGuard } from '@nestjs/passport'; // Usaremos o padrão JWT de segurança

// DTO BEM SIMPLES para o depósito
class SimulateDepositDto {
  amount: number; // Valor em centavos
}

@Controller('deposit')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  // 🚨 Usamos o AuthGuard('jwt') para garantir que só usuários logados acessem!
  @UseGuards(AuthGuard('jwt'))
  @Post('simulate')
  async simulate(@Req() req, @Body() dto: SimulateDepositDto) {
    // O 'req.user.sub' contém o 'id' do usuário do payload JWT que definimos no login.
    const userId = req.user.sub; 

    // O valor 'amount' deve estar em centavos (ex: 1000 para R$ 10,00)
    return this.depositService.simulateDeposit(userId, dto.amount);
  }
}