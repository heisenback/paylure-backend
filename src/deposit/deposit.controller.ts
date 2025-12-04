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

@Controller('deposits') // Garante que a rota é no plural
@UseGuards(HybridAuthGuard)
export class DepositController {
  private readonly logger = new Logger(DepositController.name);

  constructor(private readonly depositService: DepositService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateDepositDto, @Req() req: RequestWithUser) {
    try {
      const userId = req?.user?.id;
      
      if (!userId) {
        this.logger.warn('[DepositController] ❌ Tentativa de depósito sem usuário autenticado.');
        throw new HttpException('Usuário não autenticado.', HttpStatus.UNAUTHORIZED);
      }

      this.logger.log(`[DepositController] Criando depósito para User: ${userId} | Valor: ${dto.amount}`);

      // Monta o payload
      const payload = {
        amount: Number(dto.amount),
        externalId: dto.externalId,
        callbackUrl: dto.callbackUrl,
      };

      // Chama o serviço
      const result = await this.depositService.createDeposit(userId, payload);
      
      this.logger.log(`[DepositController] ✅ Sucesso! TransactionID: ${result.transactionId}`);
      
      return { success: true, data: result };

    } catch (e) {
      const error = e as Error;
      const errorMsg = error.message || 'Erro desconhecido';
      
      this.logger.error(`[DepositController] ❌ Falha ao criar depósito: ${errorMsg}`, error.stack);
      
      // Se já for um erro HTTP (ex: 401, 404), repassa ele
      if (e instanceof HttpException) {
        throw e;
      }
      
      // Se for erro de validação ou regra de negócio, devolve 400 (Bad Request)
      // Isso evita o erro 502 e mostra a mensagem real para o Frontend
      throw new HttpException({ 
        message: 'Erro ao processar depósito', 
        details: errorMsg 
      }, HttpStatus.BAD_REQUEST);
    }
  }
}