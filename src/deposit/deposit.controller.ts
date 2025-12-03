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
import { HybridAuthGuard } from '../auth/guards/hybrid-auth.guard';
import { DepositService } from './deposit.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    [key: string]: any;
  };
}

@Controller('deposits')
@UseGuards(HybridAuthGuard)
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
      // 🔥 AGORA NÃO PRECISA MAIS DOS DADOS DO PAYER NO DTO
      // O Service vai buscar do Merchant automaticamente
      
      this.logger.log(`[CREATE] Recebido: amount=${dto.amount}`);

      const userId = req?.user?.id;
      if (!userId) {
        this.logger.error('[CREATE] ❌ Usuário não autenticado (req.user.id não encontrado).');
        throw new HttpException({ message: 'Usuário não autenticado.' }, HttpStatus.UNAUTHORIZED);
      }

      // 🔥 PAYLOAD SIMPLIFICADO - Apenas amount é obrigatório
      const payload = {
        amount: Number(dto.amount),
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
      
      // 🔥 TRATAMENTO ESPECÍFICO PARA MERCHANT NÃO ENCONTRADO
      if (msg.includes('Merchant não encontrado') || msg.includes('dados incompletos')) {
        throw new HttpException({ 
          message: 'Erro ao criar depósito: ' + msg 
        }, HttpStatus.BAD_REQUEST);
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