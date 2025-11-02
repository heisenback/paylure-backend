// src/withdrawal/withdrawal.controller.ts
import { Body, Controller, Post, Req, UseGuards, InternalServerErrorException, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WithdrawalService } from './withdrawal.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

// Rota final será: POST /api/withdrawal/create
@Controller('withdrawal')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @UseGuards(AuthGuard('jwt'))
  @UsePipes(new ValidationPipe({ transform: true })) // Garante que o DTO seja validado e transformado
  @Post('create')
  async create(@Req() req: any, @Body() dto: CreateWithdrawalDto) {
    const user = req.user ?? {};
    
    if (!user.id) {
        throw new InternalServerErrorException('Usuário não autenticado.');
    }

    return this.withdrawalService.create(user, dto);
  }
}