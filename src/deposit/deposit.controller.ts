// src/deposit/deposit.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './create-deposit.dto';

@Controller('api/v1/deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async createDeposit(@Body() dto: CreateDepositDto, @Req() req: any) {
    // Normalização: aceita formato ANTIGO (user*) e NOVO (payer*)
    const name =
      (dto.payerName ?? dto.userName ?? '').trim();
    const email =
      (dto.payerEmail ?? dto.userEmail ?? '').trim();
    const document =
      (dto.payerDocument ?? dto.userDocument ?? '').replace(/\D+/g, '');
    const phone =
      (dto.payerPhone ?? dto.phone ?? '').replace(/\D+/g, '');

    const payload = {
      amount: Number(dto.amount),
      payerName: name,
      payerEmail: email,
      payerDocument: document,
      phone: phone || undefined,
      externalId: dto.externalId,
      callbackUrl: dto.callbackUrl,
    };

    // se tiver auth no req, pegue o id do usuário daí
    const userId = req?.user?.id ?? 'anonymous';

    const result = await this.depositService.createDeposit(userId, payload);
    return { success: true, data: result };
  }
}
