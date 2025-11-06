// src/withdrawal/withdrawal.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  async create(user: any, dto: CreateWithdrawalDto) {
    const userId = String(user.id);
    const externalId = uuidv4();
    const webhookToken = uuidv4(); 

    const amountInCents = dto.amount;
    const amountInReais = Number((amountInCents / 100).toFixed(2));
    
    const userWithBalance = await this.prisma.user.findUnique({
        where: { id: userId },
    });
    
    if (!userWithBalance) {
        throw new InternalServerErrorException('Usuário não encontrado.');
    }

    if (userWithBalance.balance < amountInCents) {
        throw new BadRequestException('Saldo insuficiente para o saque solicitado.'); 
    }
    
    let withdrawalRecordId: string | null = null;
    let isKeyclubCalled = false;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: userId },
            data: {
                balance: {
                    decrement: amountInCents,
                },
            },
        });

        const withdrawal = await (tx as any).withdrawal.create({
            data: {
                userId: userId,
                amount: amountInCents,
                status: 'PENDING',
                pixKey: dto.pix_key,
                keyType: dto.key_type,
                description: dto.description,
                externalId: externalId,
                webhookToken: webhookToken,
            },
        });
        withdrawalRecordId = withdrawal.id;

      });

      this.logger.log(`[DB OK] Saldo de ${userId} debitado. Withdrawal PENDING criado: #${withdrawalRecordId}`);

      isKeyclubCalled = true;
      
      const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;
      
      await this.keyclubService.createWithdrawal({
          amount: amountInReais,
          externalId: externalId,
          pix_key: dto.pix_key,
          key_type: keyTypeForKeyclub,
          description: dto.description,
          clientCallbackUrl: `${process.env.BASE_URL}/api/keyclub/callback/${webhookToken}`,
      });
      
      return {
          success: true,
          message: 'Saque solicitado com sucesso. Aguarde confirmação.',
          transactionId: externalId,
      };
      
    } catch (e: any) {
      this.logger.error(`[ERRO SAQUE] ${e.message}`, e.stack);
      
      if (isKeyclubCalled && withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(`KeyClub falhou (status: ${e.response?.status || 'N/A'}). Iniciando reversão de saldo para o usuário ${userId}.`);
        
        try {
          await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: userId },
                data: {
                    balance: {
                        increment: amountInCents, 
                    },
                },
            }),
            (this.prisma as any).withdrawal.update({
                where: { id: withdrawalRecordId },
                data: {
                    status: 'FAILED',
                    failureReason: failureMessage, 
                },
            }),
          ]);
          
          this.logger.log(`[REVERSÃO OK] Saldo do usuário ${userId} revertido com sucesso.`);
          throw new InternalServerErrorException(
             'Falha na solicitação de saque. Saldo estornado. Motivo: ' + failureMessage
          );
          
        } catch (reversalError: any) {
          this.logger.error(`[ERRO CRÍTICO] Falha na Reversão Atômica! Saldo debitado, Reversão falhou. User: ${userId}.`);
          throw new InternalServerErrorException('ERRO CRÍTICO: Falha no saque. Contate o suporte.');
        }
      }
      
      throw new InternalServerErrorException(e.message || 'Erro ao processar saque. Tente novamente.');
    }
  }
}