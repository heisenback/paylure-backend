// src/withdrawal/withdrawal.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { SystemSettingsService } from 'src/admin/system-settings.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  private async calculateWithdrawalFee(
    userId: string,
    amountInCents: number,
  ): Promise<{
    feePercent: number;
    feeFixed: number;
    feeInCents: number;
    netAmountInCents: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        withdrawalFeePercent: true,
        withdrawalFeeFixed: true,
        name: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    let feePercent: number;
    let feeFixed: number;

    if (user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null) {
      feePercent = user.withdrawalFeePercent;
      feeFixed = user.withdrawalFeeFixed;
      this.logger.log(
        `💼 Taxa INDIVIDUAL para ${user.name}: ${feePercent}% + R$ ${feeFixed}`,
      );
    } else {
      const globalFees = await this.systemSettings.getWithdrawalFees();
      feePercent = globalFees.percent;
      feeFixed = globalFees.fixed;
      this.logger.log(
        `🌐 Taxa GLOBAL para ${user.name}: ${feePercent}% + R$ ${feeFixed}`,
      );
    }

    const percentageFee = Math.round(amountInCents * (feePercent / 100));
    const fixedFeeInCents = Math.round(feeFixed * 100);
    const totalFee = percentageFee + fixedFeeInCents;
    const netAmount = amountInCents - totalFee;

    this.logger.log(
      `💰 Cálculo: R$ ${(amountInCents / 100).toFixed(2)} - ` +
        `(${feePercent}% = R$ ${(percentageFee / 100).toFixed(2)} + ` +
        `R$ ${feeFixed} fixo) = R$ ${(netAmount / 100).toFixed(2)} líquido`,
    );

    return {
      feePercent,
      feeFixed,
      feeInCents: totalFee,
      netAmountInCents: netAmount,
    };
  }

  async create(user: any, dto: CreateWithdrawalDto) {
    const userId = String(user.id);
    const externalId = uuidv4();
    const webhookToken = uuidv4();

    const requestedAmountInCents = dto.amount;

    const feeInfo = await this.calculateWithdrawalFee(
      userId,
      requestedAmountInCents,
    );

    if (feeInfo.netAmountInCents <= 0) {
      throw new BadRequestException(
        `Valor de saque muito baixo. Taxa de R$ ${(feeInfo.feeInCents / 100).toFixed(2)} ` +
          `excede o valor solicitado.`,
      );
    }

    const netAmountInReais = Number(
      (feeInfo.netAmountInCents / 100).toFixed(2),
    );
    if (netAmountInReais < 1) {
      throw new BadRequestException(
        `Valor líquido (R$ ${netAmountInReais.toFixed(2)}) é menor que o mínimo aceito (R$ 1,00). ` +
          `Taxa aplicada: R$ ${(feeInfo.feeInCents / 100).toFixed(2)}`,
      );
    }

    const userWithBalance = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userWithBalance) {
      throw new InternalServerErrorException('Usuário não encontrado.');
    }

    if (userWithBalance.balance < requestedAmountInCents) {
      throw new BadRequestException(
        `Saldo insuficiente. Você tem R$ ${(userWithBalance.balance / 100).toFixed(2)}, ` +
          `mas precisa de R$ ${(requestedAmountInCents / 100).toFixed(2)} para este saque.`,
      );
    }

    let withdrawalRecordId: string | null = null;
    let isKeyclubCalled = false;

    try {
      // 1. Inicia Transação no Banco (Debita Saldo + Cria Registro)
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: {
              decrement: requestedAmountInCents,
            },
          },
        });

        const withdrawal = await (tx as any).withdrawal.create({
          data: {
            userId: userId,
            amount: requestedAmountInCents,
            netAmount: feeInfo.netAmountInCents,
            feeAmount: feeInfo.feeInCents,
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
        `[Withdrawal] ✅ Saldo debitado. Withdrawal PENDING: #${withdrawalRecordId}`,
      );

      // 2. Verifica se é Saque AUTOMÁTICO ou MANUAL
      if (userWithBalance.isAutoWithdrawal) {
        this.logger.log(`🚀 [Auto] Usuário ${userWithBalance.email} tem saque automático. Processando com KeyClub...`);
        
        isKeyclubCalled = true;
        // Se for RANDOM na DTO, mapeia para EVP (mas o front agora vai mandar CPF/CNPJ)
        const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;

        // IMPORTANTE: Definir URL de callback correta
        // Se você tiver uma variável de ambiente para a URL da API, use process.env.API_URL
        // Exemplo: https://api.paylure.com.br/api/v1/webhooks/keyclub
        const apiUrl = process.env.API_URL || 'https://api.paylure.com.br'; 
        const callbackUrl = `${apiUrl}/api/v1/webhooks/keyclub/${webhookToken}`;

        // CORREÇÃO DO ERRO 500: Adicionado clientCallbackUrl
        await this.keyclubService.createWithdrawal({
          amount: netAmountInReais,
          externalId: externalId,
          pixKey: dto.pix_key,
          pixKeyType: keyTypeForKeyclub,
          clientCallbackUrl: callbackUrl, // 👈 CAMPO OBRIGATÓRIO NA DOCUMENTAÇÃO
          description: dto.description || 'Saque Paylure'
        });

        this.logger.log(
          `[Withdrawal] ✅ Saque automático enviado para KeyClub: ${externalId}`,
        );

        return {
          success: true,
          message: 'Saque enviado para processamento.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PROCESSING',
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
          feeDetails: {
            percent: feeInfo.feePercent,
            fixed: feeInfo.feeFixed,
          },
        };

      } else {
        // 3. Saque MANUAL (Cai aqui se isAutoWithdrawal = false)
        this.logger.log(`👀 [Manual] Usuário ${userWithBalance.email} requer aprovação. Saque retido como PENDING.`);
        
        return {
          success: true,
          message: 'Saque solicitado. Aguardando aprovação do administrador.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PENDING_APPROVAL',
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
          feeDetails: {
            percent: feeInfo.feePercent,
            fixed: feeInfo.feeFixed,
          },
        };
      }

    } catch (e: any) {
      this.logger.error(`[Withdrawal] ❌ ERRO: ${e.message}`, e.stack);

      // Tratamento específico para erro da Keyclub (axios error)
      if (e.response && e.response.data) {
         this.logger.error(`[Keyclub Error Data]: ${JSON.stringify(e.response.data)}`);
      }

      if (withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(
          `[Withdrawal] ⚠️ Falha. Revertendo saldo do usuário ${userId}...`,
        );

        try {
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: userId },
              data: {
                balance: {
                  increment: requestedAmountInCents,
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

          this.logger.log(`[Withdrawal] ✅ Saldo revertido com sucesso.`);

          // Não lançar erro 500 genérico se for erro de validação
          throw new BadRequestException(
            `Falha no processamento: ${failureMessage}`,
          );
        } catch (reversalError: any) {
          // Se falhar na reversão, aí sim é erro crítico
          if (reversalError instanceof BadRequestException) throw reversalError;
          
          this.logger.error(
            `[Withdrawal] 🚨 ERRO CRÍTICO: Falha na reversão! User: ${userId}`,
          );
          throw new InternalServerErrorException(
            'ERRO CRÍTICO: Falha no saque e falha na reversão. Contate o suporte imediatamente.',
          );
        }
      }

      throw new InternalServerErrorException(
        e.message || 'Erro ao processar saque. Tente novamente.',
      );
    }
  }

  async previewWithdrawal(
    userId: string,
    amountInCents: number,
  ): Promise<any> {
    const feeInfo = await this.calculateWithdrawalFee(userId, amountInCents);

    return {
      requestedAmount: amountInCents,
      feePercent: feeInfo.feePercent,
      feeFixed: feeInfo.feeFixed,
      totalFee: feeInfo.feeInCents,
      netAmount: feeInfo.netAmountInCents,
      youWillReceive: `R$ ${(feeInfo.netAmountInCents / 100).toFixed(2)}`,
    };
  }
}