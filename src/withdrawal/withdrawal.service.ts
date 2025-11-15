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

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  // 🎯 CONFIGURAÇÃO DE TAXAS (pode mover para .env depois)
  private readonly WITHDRAWAL_FEE_PERCENTAGE = 0.08; // 8%
  private readonly WITHDRAWAL_FEE_FIXED = 200; // R$ 2,00 em centavos

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  /**
   * 🎯 CALCULA TAXA DE SAQUE: 8% + R$ 2,00
   * Exemplo: R$ 100,00 -> R$ 8,00 (8%) + R$ 2,00 = R$ 10,00 de taxa
   *          Valor líquido: R$ 90,00
   */
  private calculateWithdrawalFee(amountInCents: number): {
    feeInCents: number;
    netAmountInCents: number;
  } {
    const percentageFee = Math.round(amountInCents * this.WITHDRAWAL_FEE_PERCENTAGE);
    const totalFee = percentageFee + this.WITHDRAWAL_FEE_FIXED;
    const netAmount = amountInCents - totalFee;

    this.logger.log(
      `[Taxa de Saque] Valor: R$${(amountInCents / 100).toFixed(2)} | ` +
      `Taxa 8%: R$${(percentageFee / 100).toFixed(2)} | ` +
      `Taxa Fixa: R$${(this.WITHDRAWAL_FEE_FIXED / 100).toFixed(2)} | ` +
      `Taxa Total: R$${(totalFee / 100).toFixed(2)} | ` +
      `Líquido: R$${(netAmount / 100).toFixed(2)}`
    );

    return {
      feeInCents: totalFee,
      netAmountInCents: netAmount,
    };
  }

  async create(user: any, dto: CreateWithdrawalDto) {
    const userId = String(user.id);
    const externalId = uuidv4();
    const webhookToken = uuidv4(); 

    const requestedAmountInCents = dto.amount; // Valor que o usuário quer sacar
    
    // 🎯 CALCULA TAXA ANTES DE TUDO
    const { feeInCents, netAmountInCents } = this.calculateWithdrawalFee(requestedAmountInCents);

    // Valida se o valor líquido é válido
    if (netAmountInCents <= 0) {
      throw new BadRequestException(
        `Valor de saque muito baixo. Taxa de R$${(feeInCents / 100).toFixed(2)} ` +
        `excede o valor solicitado.`
      );
    }

    // Valida se a KeyClub aceita esse valor (mínimo R$ 1,00)
    const netAmountInReais = Number((netAmountInCents / 100).toFixed(2));
    if (netAmountInReais < 1) {
      throw new BadRequestException(
        `Valor líquido (R${netAmountInReais.toFixed(2)}) é menor que o mínimo aceito (R$ 1,00). ` +
        `Taxa aplicada: R${(feeInCents / 100).toFixed(2)}`
      );
    }
    
    const userWithBalance = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    
    if (!userWithBalance) {
      throw new InternalServerErrorException('Usuário não encontrado.');
    }

    // ✅ VERIFICA SE O USUÁRIO TEM SALDO SUFICIENTE (valor solicitado, não o líquido)
    if (userWithBalance.balance < requestedAmountInCents) {
      throw new BadRequestException(
        `Saldo insuficiente. Você tem R$${(userWithBalance.balance / 100).toFixed(2)}, ` +
        `mas precisa de R$${(requestedAmountInCents / 100).toFixed(2)} para este saque.`
      ); 
    }
    
    let withdrawalRecordId: string | null = null;
    let isKeyclubCalled = false;

    try {
      // ✅ Debita VALOR SOLICITADO (com taxa) e cria registro de saque
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: {
              decrement: requestedAmountInCents, // Debita o valor SOLICITADO
            },
          },
        });

        const withdrawal = await (tx as any).withdrawal.create({
          data: {
            userId: userId,
            amount: requestedAmountInCents, // Valor SOLICITADO (com taxa)
            netAmount: netAmountInCents, // Valor LÍQUIDO (sem taxa)
            feeAmount: feeInCents, // Taxa cobrada
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

      this.logger.log(
        `[WithdrawalService] ✅ Saldo debitado. ` +
        `Valor solicitado: R$${(requestedAmountInCents / 100).toFixed(2)} | ` +
        `Taxa: R$${(feeInCents / 100).toFixed(2)} | ` +
        `Enviando para KeyClub: R$${netAmountInReais.toFixed(2)} | ` +
        `Withdrawal PENDING: #${withdrawalRecordId}`
      );

      // ✅ Chama KeyClub com o valor LÍQUIDO (sem nossa taxa)
      isKeyclubCalled = true;
      
      const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;
      const callbackUrl = `${process.env.BASE_URL || 'https://api.paylure.com.br'}/api/v1/keyclub/callback/${webhookToken}`;
      
      await this.keyclubService.createWithdrawal({
        amount: netAmountInReais, // Envia valor LÍQUIDO para KeyClub
        externalId: externalId,
        pix_key: dto.pix_key,
        key_type: keyTypeForKeyclub,
        description: dto.description || 'Saque via Paylure',
        clientCallbackUrl: callbackUrl,
      });
      
      this.logger.log(`[WithdrawalService] ✅ Saque enviado para KeyClub: ${externalId}`);
      
      return {
        success: true,
        message: 'Saque solicitado com sucesso. Aguarde confirmação.',
        transactionId: externalId,
        requestedAmount: requestedAmountInCents,
        fee: feeInCents,
        netAmount: netAmountInCents,
      };
      
    } catch (e: any) {
      this.logger.error(`[WithdrawalService] ❌ ERRO: ${e.message}`, e.stack);
      
      // ✅ Se KeyClub falhou, reverte o saldo
      if (isKeyclubCalled && withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(`[WithdrawalService] ⚠️ KeyClub falhou. Revertendo saldo do usuário ${userId}...`);
        
        try {
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: userId },
              data: {
                balance: {
                  increment: requestedAmountInCents, // Reverte valor SOLICITADO
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
          
          this.logger.log(`[WithdrawalService] ✅ Saldo revertido com sucesso.`);
          
          throw new InternalServerErrorException(
            `Falha na solicitação de saque. Saldo estornado. Motivo: ${failureMessage}`
          );
          
        } catch (reversalError: any) {
          this.logger.error(`[WithdrawalService] 🚨 ERRO CRÍTICO: Falha na reversão! User: ${userId}`);
          throw new InternalServerErrorException('ERRO CRÍTICO: Falha no saque. Contate o suporte.');
        }
      }
      
      throw new InternalServerErrorException(e.message || 'Erro ao processar saque. Tente novamente.');
    }
  }
}