// src/deposit/deposit.controller.ts

import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common'; 
import { DepositService } from './deposit.service';
import { AuthGuard } from '@nestjs/passport';
import { CreateDepositDto } from './dto/create-deposit.dto';

@Controller('deposits') 
@UseGuards(AuthGuard('jwt'))
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post() 
  async create(@Req() req, @Body() dto: CreateDepositDto) { // 🚨 Agora usa o DTO com o campo 'amount'
    
    const userId = req.user.sub || req.user.id || (req.user as any).user?.id;

    if (!userId) {
        throw new Error('Usuário autenticado, mas o ID do usuário está faltando no Token.');
    }
    
    return this.depositService.createDeposit(userId, dto);
  }

  @Get('history')
  async getHistory(@Req() req) {
    const userId = req.user.sub || req.user.id || (req.user as any).user?.id;

    if (!userId) {
        throw new Error('Usuário autenticado, mas o ID do usuário está faltando no Token.');
    }

    return this.depositService.getHistory(userId);
  }
}