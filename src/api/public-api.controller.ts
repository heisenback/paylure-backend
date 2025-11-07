// src/api/public-api.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DepositService } from '../deposit/deposit.service';
import { CreateDepositDto } from '../dto/create-deposit.dto';

@Controller('api/v1/public')
export class PublicApiController {
  private readonly logger = new Logger(PublicApiController.name);

  constructor(private readonly depositService: DepositService) {}

  @UseGuards(JwtAuthGuard)
  @Post('deposits')
  @HttpCode(HttpStatus.CREATED)
  async createDeposit(@Request() req: any, @Body() dto: CreateDepositDto) {
    const user = req.user;

    // Monta o DTO completo que o DepositService.create() espera
    const fullDepositDto = {
      amount: dto.amount,
      payerName: user.name || 'Cliente Paylure',
      payerEmail: user.email || 'cliente@paylure.com',
      payerDocument: user.document || '00000000000',
      externalId: `deposit_${Date.now()}_${user.id}`,
      phone: user.phone,
    };

    this.logger.log(`[PublicApiController] Criando depósito para userId=${user.id} amount=${dto.amount}`);

    // Chama o método create() do service
    const result = await this.depositService.create(fullDepositDto);

    // Retorna apenas os campos que existem no resultado
    return {
      success: true,
      data: {
        transactionId: result.transactionId,
        qrcode: result.qrcode,
        amount: result.amount,
        status: result.status,
        message: result.message,
      },
    };
  }
}