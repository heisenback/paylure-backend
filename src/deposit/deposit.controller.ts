// src/deposit/deposit.controller.ts
import { 
  Body, 
  Controller, 
  HttpCode, 
  HttpException,
  HttpStatus, 
  Logger,
  Post, 
  Req,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

@Controller('deposits') // ✅ CORREÇÃO: Sem 'api/v1/' (já está no main.ts)
export class DepositController {
  private readonly logger = new Logger(DepositController.name);

  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: false // ✅ PERMITE CAMPOS EXTRAS
  }))
  async create(@Body() dto: CreateDepositDto, @Req() req: any) {
    try {
      // ✅ Normalização: aceita formato ANTIGO (user*) e NOVO (payer*)
      const name = (dto.payerName || '').trim() || 'Usuário da Gateway';
      const email = (dto.payerEmail || '').trim();
      const document = (dto.payerDocument || '').replace(/\D+/g, '');
      const phone = (dto.payerPhone || dto.phone || '').replace(/\D+/g, '');

      this.logger.log(`[CREATE] Recebido: amount=${dto.amount}, payer=${name}`);

      const payload = {
        amount: Number(dto.amount),
        payerName: name,
        payerEmail: email,
        payerDocument: document,
        phone: phone || undefined,
        externalId: dto.externalId,
        callbackUrl: dto.callbackUrl,
      };

      // Se tiver auth no req, pegue o id do usuário
      const userId = req?.user?.id ?? 'anonymous';

      const result = await this.depositService.createDeposit(userId, payload);
      
      this.logger.log(`[CREATE] ✅ Depósito criado com sucesso: ${result.transactionId}`);
      
      return { success: true, data: result };
    } catch (e) {
      const msg = (e as Error).message || 'Erro ao criar depósito.';
      this.logger.error(`[CREATE] ❌ ${msg}`);
      
      if (e instanceof HttpException) {
        throw e;
      }
      
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