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

  /**
   * 🎯 CALCULA TAXA DE SAQUE (DINÂMICA - Global ou Individual)
   * Prioridade: Individual > Global
   */
  private async calculateWithdrawalFee(
    userId: string,
    amountInCents: number,
  ): Promise<{
    feePercent: number;
    feeFixed: number;
    feeInCents: number;
    netAmountInCents: number;
  }> {
    // Busca configurações do usuário
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        withdrawalFeePercent: true,
        withdrawalFeeFixed: true,
        name: true,
      },
    });

    let feePercent: number;
    let feeFixed: number;

    // Se usuário tem taxa individual, usa ela
    if (user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null) {
      feePercent = user.withdrawalFeePercent;
      feeFixed = user.withdrawalFeeFixed;
      this.logger.log(
        `💼 Taxa INDIVIDUAL para ${user.name}: ${feePercent}% + R$ ${feeFixed}`,
      );
    } else {
      // Senão, usa taxa global
      const globalFees = await this.systemSettings.getWithdrawalFees();
      feePercent = globalFees.percent;
      feeFixed = globalFees.fixed;
      this.logger.log(
        `🌍 Taxa GLOBAL para ${user.name}: ${feePercent}% + R$ ${feeFixed}`,
      );
    }

    // Calcula taxa em centavos
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

    // 🎯 CALCULA TAXA DINÂMICA (Global ou Individual)
    const feeInfo = await this.calculateWithdrawalFee(
      userId,
      requestedAmountInCents,
    );

    // Valida se o valor líquido é válido
    if (feeInfo.netAmountInCents <= 0) {
      throw new BadRequestException(
        `Valor de saque muito baixo. Taxa de R$ ${(feeInfo.feeInCents / 100).toFixed(2)} ` +
          `excede o valor solicitado.`,
      );
    }

    // Valida se a KeyClub aceita esse valor (mínimo R$ 1,00)
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

    // ✅ VERIFICA SE O USUÁRIO TEM SALDO SUFICIENTE
    if (userWithBalance.balance < requestedAmountInCents) {
      throw new BadRequestException(
        `Saldo insuficiente. Você tem R$ ${(userWithBalance.balance / 100).toFixed(2)}, ` +
          `mas precisa de R$ ${(requestedAmountInCents / 100).toFixed(2)} para este saque.`,
      );
    }

    let withdrawalRecordId: string | null = null;
    let isKeyclubCalled = false;

    try {
      // ✅ Debita valor solicitado e cria registro de saque
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
        `[Withdrawal] ✅ Saldo debitado. ` +
          `Valor solicitado: R$ ${(requestedAmountInCents / 100).toFixed(2)} | ` +
          `Taxa (${feeInfo.feePercent}% + R$ ${feeInfo.feeFixed}): R$ ${(feeInfo.feeInCents / 100).toFixed(2)} | ` +
          `Enviando para KeyClub: R$ ${netAmountInReais.toFixed(2)} | ` +
          `Withdrawal PENDING: #${withdrawalRecordId}`,
      );

      // ✅ Chama KeyClub com o valor LÍQUIDO
      isKeyclubCalled = true;

      const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;
      const callbackUrl = `${process.env.BASE_URL || 'https://api.paylure.com.br'}/api/v1/keyclub/callback/${webhookToken}`;

      await this.keyclubService.createWithdrawal({
        amount: netAmountInReais,
        externalId: externalId,
        pix_key: dto.pix_key,
        key_type: keyTypeForKeyclub,
        description: dto.description || 'Saque via Paylure',
        clientCallbackUrl: callbackUrl,
      });

      this.logger.log(
        `[Withdrawal] ✅ Saque enviado para KeyClub: ${externalId}`,
      );

      return {
        success: true,
        message: 'Saque solicitado com sucesso. Aguarde confirmação.',
        transactionId: externalId,
        requestedAmount: requestedAmountInCents,
        fee: feeInfo.feeInCents,
        netAmount: feeInfo.netAmountInCents,
        feeDetails: {
          percent: feeInfo.feePercent,
          fixed: feeInfo.feeFixed,
        },
      };
    } catch (e: any) {
      this.logger.error(`[Withdrawal] ❌ ERRO: ${e.message}`, e.stack);

      // ✅ Se KeyClub falhou, reverte o saldo
      if (isKeyclubCalled && withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(
          `[Withdrawal] ⚠️ KeyClub falhou. Revertendo saldo do usuário ${userId}...`,
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

          throw new InternalServerErrorException(
            `Falha na solicitação de saque. Saldo estornado. Motivo: ${failureMessage}`,
          );
        } catch (reversalError: any) {
          this.logger.error(
            `[Withdrawal] 🚨 ERRO CRÍTICO: Falha na reversão! User: ${userId}`,
          );
          throw new InternalServerErrorException(
            'ERRO CRÍTICO: Falha no saque. Contate o suporte.',
          );
        }
      }

      throw new InternalServerErrorException(
        e.message || 'Erro ao processar saque. Tente novamente.',
      );
    }
  }

  /**
   * 🎯 PREVIEW DE SAQUE - Mostra quanto o usuário vai receber
   */
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