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

  // 🔥 HELPER DE SEGURANÇA: Garante a formatação correta para o Banco
  private formatPixKey(key: string, type: string): string {
    // Remove tudo que não é número para limpar
    const clean = key.replace(/\D/g, ''); 

    // SE FOR CPF: Obriga a colocar pontos e traço (Ex: 119.803.259-60)
    // Isso garante que o banco NÃO confunda com telefone celular
    if (type === 'CPF') {
      if (clean.length === 11) {
         return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      }
    }

    // SE FOR CNPJ: Obriga a formatação de CNPJ
    if (type === 'CNPJ') {
      if (clean.length === 14) {
        return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      }
    }

    // SE FOR TELEFONE: Manda limpo (só números)
    if (type === 'PHONE' || type === 'TELEFONE') {
      return clean; 
    }

    // E-MAIL ou CHAVE ALEATÓRIA: Retorna como está
    return key;
  }

  // Lógica de Cálculo de Taxas (Individual vs Global)
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

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    let feePercent: number;
    let feeFixed: number;

    // REGRA 1: Verifica se tem taxa diferenciada (Individual)
    if (user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null) {
      feePercent = user.withdrawalFeePercent;
      feeFixed = user.withdrawalFeeFixed;
      this.logger.log(
        `💼 Taxa INDIVIDUAL usada para ${user.name}: ${feePercent}% + R$ ${feeFixed}`,
      );
    } else {
      // REGRA 2: Se não tiver, usa a taxa padrão do site (Global)
      const globalFees = await this.systemSettings.getWithdrawalFees();
      feePercent = globalFees.percent;
      feeFixed = globalFees.fixed;
      this.logger.log(
        `🌐 Taxa GLOBAL usada para ${user.name}: ${feePercent}% + R$ ${feeFixed}`,
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

    // 1. Calcula as taxas
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

    // REGRA 3: Verifica se o saque é automático
    const isAuto = !!userWithBalance.isAutoWithdrawal;
    this.logger.log(`🔍 [Check Saque] User: ${userWithBalance.email} | Automático: ${isAuto}`);

    let withdrawalRecordId: string | null = null;

    try {
      // Inicia Transação no Banco (Debita Saldo + Cria Registro)
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
        `[Withdrawal] ✅ Saldo debitado. ID: #${withdrawalRecordId}`,
      );

      // SE FOR AUTOMÁTICO -> Envia para Keyclub
      if (isAuto) {
        this.logger.log(`🚀 [Auto] Usuário tem saque automático. Processando...`);
        
        const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;

        // Configura URL de Callback para evitar erro 500
        const apiUrl = process.env.API_URL || process.env.BASE_URL || 'https://api.paylure.com.br'; 
        const callbackUrl = `${apiUrl}/api/v1/webhooks/keyclub/${webhookToken}`;

        // 🔥 APLICA A FORMATAÇÃO SEGURA NA CHAVE
        const formattedKey = this.formatPixKey(dto.pix_key, dto.key_type);
        this.logger.log(`🔑 Chave formatada enviada: "${formattedKey}" (Tipo Original: ${dto.key_type})`);

        await this.keyclubService.createWithdrawal({
          amount: netAmountInReais,
          externalId: externalId,
          pixKey: formattedKey, // Usa a chave formatada
          pixKeyType: keyTypeForKeyclub,
          clientCallbackUrl: callbackUrl, 
          description: dto.description || 'Saque Paylure'
        });

        this.logger.log(
          `[Withdrawal] ✅ Sucesso! Enviado para KeyClub.`,
        );

        return {
          success: true,
          message: 'Saque automático enviado para processamento.',
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
        // SE FOR MANUAL -> Retém para aprovação
        this.logger.log(`👀 [Manual] Saque retido para aprovação (Configuração do usuário é Manual).`);
        
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

      // Se falhar, devolve o dinheiro
      if (withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(
          `[Withdrawal] ⚠️ Falha. Revertendo saldo...`,
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

          this.logger.log(`[Withdrawal] ✅ Saldo revertido.`);

          throw new BadRequestException(
            `Falha no processamento: ${failureMessage}`,
          );
        } catch (reversalError: any) {
          if (reversalError instanceof BadRequestException) throw reversalError;
          throw new InternalServerErrorException(
            'ERRO CRÍTICO: Falha no saque e falha na reversão. Contate o suporte.',
          );
        }
      }

      throw new InternalServerErrorException(
        e.message || 'Erro ao processar saque.',
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