// src/withdrawal/withdrawal.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WithdrawalService } from './withdrawal.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    [key: string]: any;
  };
}

@Controller('withdrawals')
@UseGuards(AuthGuard('jwt'))
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  /**
   * GET /api/v1/withdrawals/preview?amount=10000
   * Mostra quanto o usuário vai receber antes de confirmar
   */
  @Get('preview')
  async previewWithdrawal(
    @GetUser() user: any,
    @Query('amount') amount: string,
  ) {
    const amountInCents = parseInt(amount, 10);
    
    if (!amountInCents || amountInCents <= 0) {
      throw new BadRequestException('Valor inválido');
    }
    
    return await this.withdrawalService.previewWithdrawal(user.id, amountInCents);
  }

  /**
   * POST /api/v1/withdrawals
   * Cria um novo saque
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async create(
    @Req() req: RequestWithUser,
    @Body() createWithdrawalDto: CreateWithdrawalDto,
  ) {
    return this.withdrawalService.create(req.user, createWithdrawalDto);
  }
}