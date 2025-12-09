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

  // 🔥 HELPER: Garante a formatação correta para o Banco
  private formatPixKey(key: string, type: string): string {
    const clean = key.replace(/\D/g, ''); 

    // CPF: Obriga pontos e traço (119.803.259-60)
    if (type === 'CPF') {
      if (clean.length === 11) {
         return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      }
    }

    // CNPJ: Obriga formatação
    if (type === 'CNPJ') {
      if (clean.length === 14) {
        return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      }
    }

    // TELEFONE: Manda limpo (só números)
    if (type === 'PHONE' || type === 'TELEFONE') {
      return clean; 
    }

    // E-MAIL ou CHAVE ALEATÓRIA: Retorna como está
    return key;
  }

  // Lógica de Cálculo de Taxas
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

    // Prioridade: Taxa Individual > Taxa Global
    if (user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null) {
      feePercent = user.withdrawalFeePercent;
      feeFixed = user.withdrawalFeeFixed;
      this.logger.log(`💼 Taxa INDIVIDUAL para ${user.name}: ${feePercent}% + R$ ${feeFixed}`);
    } else {
      const globalFees = await this.systemSettings.getWithdrawalFees();
      feePercent = globalFees.percent;
      feeFixed = globalFees.fixed;
      this.logger.log(`🌐 Taxa GLOBAL para ${user.name}: ${feePercent}% + R$ ${feeFixed}`);
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

    // 1. Cálculos de Taxa
    const feeInfo = await this.calculateWithdrawalFee(
      userId,
      requestedAmountInCents,
    );

    if (feeInfo.netAmountInCents <= 0) {
      throw new BadRequestException(`Valor líquido inválido após taxas.`);
    }

    const netAmountInReais = Number((feeInfo.netAmountInCents / 100).toFixed(2));
    if (netAmountInReais < 1) {
      throw new BadRequestException(`Valor mínimo para saque é R$ 1,00.`);
    }

    const userWithBalance = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userWithBalance) throw new InternalServerErrorException('Usuário não encontrado.');
    if (userWithBalance.balance < requestedAmountInCents) {
      throw new BadRequestException(`Saldo insuficiente.`);
    }

    const isAuto = !!userWithBalance.isAutoWithdrawal;
    this.logger.log(`🔍 [Check Saque] User: ${userWithBalance.email} | Auto: ${isAuto}`);

    let withdrawalRecordId: string | null = null;

    try {
      // 2. Inicia Transação no Banco (Debita Saldo + Cria Registro PENDING)
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { decrement: requestedAmountInCents },
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

      this.logger.log(`[Withdrawal] ✅ Saldo debitado. ID: #${withdrawalRecordId}`);

      // 3. Processamento Automático ou Manual
      if (isAuto && withdrawalRecordId) {
        this.logger.log(`🚀 [Auto] Usuário tem saque automático. Processando...`);
        
        const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;
        const apiUrl = process.env.API_URL || process.env.BASE_URL || 'https://api.paylure.com.br'; 
        const callbackUrl = `${apiUrl}/api/v1/webhooks/keyclub/${webhookToken}`;

        // Aplica formatação segura (CPF com pontos, Fone sem)
        const formattedKey = this.formatPixKey(dto.pix_key, dto.key_type);
        this.logger.log(`🔑 Chave formatada enviada: "${formattedKey}"`);

        // Envia para Keyclub
        await this.keyclubService.createWithdrawal({
          amount: netAmountInReais,
          externalId: externalId,
          pixKey: formattedKey,
          pixKeyType: keyTypeForKeyclub,
          clientCallbackUrl: callbackUrl, 
          description: dto.description || 'Saque Paylure'
        });

        // 🔥 CORREÇÃO DO PAGAMENTO DUPLO 🔥
        // Atualiza IMEDIATAMENTE o status no banco para não aparecer como pendente no Admin
        await this.prisma.withdrawal.update({
          where: { id: withdrawalRecordId },
          data: { status: 'PROCESSING' }
        });

        this.logger.log(`[Withdrawal] ✅ Saque auto enviado e status atualizado para PROCESSING.`);

        return {
          success: true,
          message: 'Saque enviado para processamento.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PROCESSING',
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
          feeDetails: { percent: feeInfo.feePercent, fixed: feeInfo.feeFixed },
        };

      } else {
        // Saque Manual
        this.logger.log(`👀 [Manual] Saque retido como PENDING.`);
        
        return {
          success: true,
          message: 'Saque solicitado. Aguardando aprovação do administrador.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PENDING_APPROVAL',
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
          feeDetails: { percent: feeInfo.feePercent, fixed: feeInfo.feeFixed },
        };
      }

    } catch (e: any) {
      this.logger.error(`[Withdrawal] ❌ ERRO: ${e.message}`, e.stack);

      if (withdrawalRecordId) {
        const failureMessage = e.message.substring(0, 255);
        this.logger.warn(`[Withdrawal] ⚠️ Falha. Revertendo saldo...`);

        try {
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: userId },
              data: { balance: { increment: requestedAmountInCents } },
            }),
            (this.prisma as any).withdrawal.update({
              where: { id: withdrawalRecordId },
              data: { status: 'FAILED', failureReason: failureMessage },
            }),
          ]);

          this.logger.log(`[Withdrawal] ✅ Saldo revertido com sucesso.`);
          throw new BadRequestException(`Falha no processamento: ${failureMessage}`);
          
        } catch (reversalError: any) {
          if (reversalError instanceof BadRequestException) throw reversalError;
          this.logger.error(`[Withdrawal] 🚨 ERRO CRÍTICO NA REVERSÃO! User: ${userId}`);
          throw new InternalServerErrorException('ERRO CRÍTICO: Falha no saque e falha na reversão. Contate o suporte.');
        }
      }

      throw new InternalServerErrorException(e.message || 'Erro ao processar saque.');
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