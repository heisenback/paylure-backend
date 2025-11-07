// src/deposit/deposit.controller.ts
import { Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post } from '@nestjs/common';
import { DepositService } from './deposit.service';

class CreateDepositBody {
  amount!: number;
  payerName!: string;
  payerEmail!: string;
  payerDocument!: string; // CPF/CNPJ
  externalId?: string;
  callbackUrl?: string;
  phone?: string;
}

@Controller('deposits') // ✅ Usa apenas 'deposits' pois o prefixo global já adiciona 'api/v1'
export class DepositController {
  private readonly logger = new Logger(DepositController.name);

  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateDepositBody) {
    try {
      const data = await this.depositService.create({
        amount: Number(body.amount),
        payerName: body.payerName,
        payerEmail: body.payerEmail,
        payerDocument: body.payerDocument,
        externalId: body.externalId,
        callbackUrl: body.callbackUrl,
        phone: body.phone,
      });
      return data;
    } catch (e) {
      const msg = (e as Error).message || 'Erro ao criar depósito.';
      this.logger.error(`[DepositController] ❌ ${msg}`);
      // Normaliza status para o front
      if (msg.includes('autenticação') || msg.includes('token')) {
        throw new HttpException({ message: msg }, HttpStatus.UNAUTHORIZED);
      }
      if (msg.toLowerCase().includes('gateway temporariamente indisponível')) {
        throw new HttpException({ message: msg }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw new HttpException({ message: msg }, HttpStatus.BAD_GATEWAY);
    }
  }
}