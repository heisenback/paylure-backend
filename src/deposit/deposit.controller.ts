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

@Controller('deposits')
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

      this.logger.log(`[DepositController] ==========================================`);
      this.logger.log(`[DepositController] Criando depósito para User: ${userId}`);
      this.logger.log(`[DepositController] Valor recebido: ${dto.amount} centavos`);
      this.logger.log(`[DepositController] Payload completo:`);
      this.logger.log(JSON.stringify(dto, null, 2));

      // Valida o valor
      if (!dto.amount || dto.amount < 100) {
        throw new HttpException('Valor mínimo de depósito é R$ 1,00', HttpStatus.BAD_REQUEST);
      }

      // Monta o payload
      const payload = {
        amount: Number(dto.amount), // Em centavos
        externalId: dto.externalId,
        callbackUrl: dto.callbackUrl,
      };

      this.logger.log(`[DepositController] Chamando DepositService...`);

      // Chama o serviço
      const result = await this.depositService.createDeposit(userId, payload);
      
      this.logger.log(`[DepositController] ✅ Sucesso! TransactionID: ${result.transactionId}`);
      this.logger.log(`[DepositController] QR Code gerado: ${result.qrcode?.substring(0, 50)}...`);
      
      return { 
        success: true, 
        data: result 
      };

    } catch (e) {
      const error = e as Error;
      const errorMsg = error.message || 'Erro desconhecido';
      
      this.logger.error(`[DepositController] ❌ Falha ao criar depósito: ${errorMsg}`);
      this.logger.error(`[DepositController] Stack trace:`, error.stack);
      
      // Se já for um erro HTTP (ex: 401, 404), repassa ele
      if (e instanceof HttpException) {
        throw e;
      }
      
      // Se for erro de validação ou regra de negócio, devolve 400 (Bad Request)
      throw new HttpException({ 
        success: false,
        message: 'Erro ao processar depósito', 
        details: errorMsg 
      }, HttpStatus.BAD_REQUEST);
    }
  }
}