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
  ValidationPipe,
  UseGuards
} from '@nestjs/common';
import { HybridAuthGuard } from '../auth/guards/hybrid-auth.guard'; // 👈 IMPORTAR
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    [key: string]: any;
  };
}

@Controller('deposits')
@UseGuards(HybridAuthGuard) // 👈 MUDOU AQUI!
export class DepositController {
  private readonly logger = new Logger(DepositController.name);

  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ 
    transform: true, 
    whitelist: true,
    forbidNonWhitelisted: false
  }))
  async create(@Body() dto: CreateDepositDto, @Req() req: RequestWithUser) {
    try {
      const name = (dto.payerName || dto.userName || '').trim() || 'Usuário da Gateway';
      const email = (dto.payerEmail || dto.userEmail || '').trim();
      const document = (dto.payerDocument || dto.userDocument || '').replace(/\D+/g, '');
      const phone = (dto.payerPhone || dto.phone || '').replace(/\D+/g, '');

      this.logger.log(`[CREATE] Recebido: amount=${dto.amount}, payer=${name}`);

      const userId = req?.user?.id;
      if (!userId) {
        this.logger.error('[CREATE] ❌ Usuário não autenticado (req.user.id não encontrado).');
        throw new HttpException({ message: 'Usuário não autenticado.' }, HttpStatus.UNAUTHORIZED);
      }

      const payload = {
        amount: Number(dto.amount),
        payerName: name,
        payerEmail: email,
        payerDocument: document,
        phone: phone || undefined,
        externalId: dto.externalId,
        callbackUrl: dto.callbackUrl,
      };

      this.logger.log(`[CREATE] Chamando depositService para userId=${userId}`);
      
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