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
import { Prisma } from '@prisma/client'; // Importar tipos do Prisma

// O módulo foi movido, mas a classe ainda é a mesma
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

    // 1. Validar e converter o valor (KeyClub espera REAIS)
    const amountInCents = dto.amount;
    const amountInReais = Number((amountInCents / 100).toFixed(2));
    
    // 2. Pré-verificação de Saldo Suficiente
    const userWithBalance = await this.prisma.user.findUnique({
        where: { id: userId },
    });
    
    if (!userWithBalance) {
        throw new InternalServerErrorException('Usuário não encontrado.');
    }

    if (userWithBalance.balance < amountInCents) {
        throw new BadRequestException('Saldo insuficiente para o saque solicitado.'); 
    }
    
    let withdrawalRecordId: string | null = null; // Usaremos o ID do registro criado
    let isKeyclubCalled = false; // Flag para rastrear a chamada externa

    try {
      // =========================================================================
      // ETAPA 1: Operação Atômica no DB (Debita e Cria o Registro PENDENTE)
      // =========================================================================
      await this.prisma.$transaction(async (tx) => {
        // A. Debita o saldo do Usuário (Decrement)
        await tx.user.update({
            where: { id: userId },
            data: {
                balance: {
                    decrement: amountInCents,
                },
            },
        });

        // B. 🚨 REGISTRA O WITHDRAWAL NO BANCO DE DADOS
        const withdrawal = await (tx as any).withdrawal.create({
            data: {
                userId: userId,
                amount: amountInCents, // Salva em centavos
                status: 'PENDING',
                pixKey: dto.pix_key,
                keyType: dto.key_type,
                description: dto.description,
                externalId: externalId,
                webhookToken: webhookToken, // Salvamos o token aqui
            },
        });
        withdrawalRecordId = withdrawal.id; // Armazena o ID do registro

      }); // Fim do $transaction: O Débito e o Registro PENDING estão confirmados.

      this.logger.log(`[DB OK] Saldo de ${userId} debitado. Withdrawal PENDING criado: #${withdrawalRecordId}`);

      // =========================================================================
      // ETAPA 2: Chamada Externa (KeyClub) - OBRIGATORIAMENTE FORA da transação
      // =========================================================================
      isKeyclubCalled = true;
      await this.keyclubService.createWithdrawal({
          amount: amountInReais, // EM REAIS
          externalId: externalId,
          pix_key: dto.pix_key,
          key_type: dto.key_type,
          description: dto.description,
          clientCallbackUrl: `${process.env.BASE_URL}/api/keyclub/callback/${webhookToken}`,
      });
      
      // 3. Retorna sucesso
      return {
          success: true,
          message: 'Saque solicitado com sucesso. Aguarde confirmação.',
          transactionId: externalId,
      };
      
    } catch (e: any) {
      // =========================================================================
      // ETAPA 3: TRATAMENTO DE ERRO E REVERSÃO (Se a KeyClub falhar)
      // =========================================================================
      this.logger.error(`[ERRO SAQUE] ${e.message}`, e.stack);
      
      // Se a falha ocorreu na Chamada Externa (Etapa 2) e o débito foi feito (withdrawalRecordId existe)
      if (isKeyclubCalled && withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(`KeyClub falhou (status: ${e.response?.status || 'N/A'}). Iniciando reversão de saldo para o usuário ${userId}.`);
        
        try {
          // Reverte o débito e marca o registro como FAILED/REVERSED
          await this.prisma.$transaction([
            // Reverte o débito: Incrementa o saldo do Usuário
            this.prisma.user.update({
                where: { id: userId },
                data: {
                    balance: {
                        increment: amountInCents, 
                    },
                },
            }),
            // Marca o registro como FAILED/REVERSED
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
          // ERRO CRÍTICO: Falha ao reverter o saldo.
          this.logger.error(`[ERRO CRÍTICO] Falha na Reversão Atômica! Saldo debitado, Reversão falhou. User: ${userId}.`);
          throw new InternalServerErrorException('ERRO CRÍTICO: Falha no saque. Contate o suporte.');
        }
      }
      
      // Se a falha ocorreu antes da chamada externa (ex: validação DTO), apenas lança o erro.
      throw new InternalServerErrorException(e.message || 'Erro ao processar saque. Tente novamente.');
    }
  }
}