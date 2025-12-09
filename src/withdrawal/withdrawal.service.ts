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

  // 🔥 HELPER: Formatação de Chave Pix
  private formatPixKey(key: string, type: string): string {
    const clean = key.replace(/\D/g, ''); 

    // CPF: Obriga pontos e traço
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
    // TELEFONE: Manda limpo
    if (type === 'PHONE' || type === 'TELEFONE') {
      return clean; 
    }
    return key;
  }

  // Cálculo de Taxas
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
      select: { withdrawalFeePercent: true, withdrawalFeeFixed: true, name: true },
    });

    if (!user) throw new BadRequestException('Usuário não encontrado.');

    let feePercent: number;
    let feeFixed: number;

    if (user.withdrawalFeePercent !== null && user.withdrawalFeeFixed !== null) {
      feePercent = user.withdrawalFeePercent;
      feeFixed = user.withdrawalFeeFixed;
    } else {
      const globalFees = await this.systemSettings.getWithdrawalFees();
      feePercent = globalFees.percent;
      feeFixed = globalFees.fixed;
    }

    const percentageFee = Math.round(amountInCents * (feePercent / 100));
    const fixedFeeInCents = Math.round(feeFixed * 100);
    const totalFee = percentageFee + fixedFeeInCents;
    const netAmount = amountInCents - totalFee;

    return { feePercent, feeFixed, feeInCents: totalFee, netAmountInCents: netAmount };
  }

  async create(user: any, dto: CreateWithdrawalDto) {
    const userId = String(user.id);
    const externalId = uuidv4();
    const webhookToken = uuidv4();
    const requestedAmountInCents = dto.amount;

    const feeInfo = await this.calculateWithdrawalFee(userId, requestedAmountInCents);

    if (feeInfo.netAmountInCents <= 0) throw new BadRequestException(`Valor líquido inválido.`);
    const netAmountInReais = Number((feeInfo.netAmountInCents / 100).toFixed(2));
    if (netAmountInReais < 1) throw new BadRequestException(`Valor mínimo R$ 1,00.`);

    const userWithBalance = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!userWithBalance) throw new InternalServerErrorException('Usuário não encontrado.');
    if (userWithBalance.balance < requestedAmountInCents) throw new BadRequestException(`Saldo insuficiente.`);

    const isAuto = !!userWithBalance.isAutoWithdrawal;
    this.logger.log(`🔍 [Check Saque] User: ${userWithBalance.email} | Auto: ${isAuto}`);

    let withdrawalRecordId: string | null = null;

    try {
      // 1. Cria Registro como PENDING no banco
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: requestedAmountInCents } },
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

      // 2. SE FOR AUTOMÁTICO -> Envia e ATUALIZA O STATUS IMEDIATAMENTE
      if (isAuto && withdrawalRecordId) {
        this.logger.log(`🚀 [Auto] Processando saque automático...`);
        
        const keyTypeForKeyclub = dto.key_type === 'RANDOM' ? 'EVP' : dto.key_type;
        const apiUrl = process.env.API_URL || process.env.BASE_URL || 'https://api.paylure.com.br'; 
        const callbackUrl = `${apiUrl}/api/v1/webhooks/keyclub/${webhookToken}`;
        const formattedKey = this.formatPixKey(dto.pix_key, dto.key_type);

        // Envia para Keyclub
        await this.keyclubService.createWithdrawal({
          amount: netAmountInReais,
          externalId: externalId,
          pixKey: formattedKey,
          pixKeyType: keyTypeForKeyclub,
          clientCallbackUrl: callbackUrl, 
          description: dto.description || 'Saque Paylure'
        });

        // 🔥 CORREÇÃO CRÍTICA AQUI 🔥
        // Atualiza IMEDIATAMENTE para 'COMPLETED' (Concluído)
        // Isso impede que ele apareça na lista de pendentes do Admin
        await this.prisma.withdrawal.update({
          where: { id: withdrawalRecordId },
          data: { 
            status: 'COMPLETED',
            description: 'Saque Automático (Enviado com Sucesso)'
          }
        });

        this.logger.log(`[Withdrawal] ✅ Saque auto enviado e status atualizado para COMPLETED.`);

        return {
          success: true,
          message: 'Saque enviado com sucesso.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'COMPLETED', // Retorna como concluído para o front
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
          feeDetails: { percent: feeInfo.feePercent, fixed: feeInfo.feeFixed },
        };

      } else {
        // 3. SE FOR MANUAL -> Deixa PENDING para você aprovar
        this.logger.log(`👀 [Manual] Saque retido como PENDING.`);
        return {
          success: true,
          message: 'Aguardando aprovação.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PENDING_APPROVAL',
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
          feeDetails: { percent: feeInfo.feePercent, fixed: feeInfo.feeFixed },
        };
      }

    } catch (e: any) {
      this.logger.error(`[Withdrawal] ❌ ERRO: ${e.message}`);
      if (withdrawalRecordId) {
        try {
          // Reverte Saldo
          await this.prisma.$transaction([
            this.prisma.user.update({ where: { id: userId }, data: { balance: { increment: requestedAmountInCents } } }),
            (this.prisma as any).withdrawal.update({ where: { id: withdrawalRecordId }, data: { status: 'FAILED', failureReason: e.message } }),
          ]);
        } catch (revErr) { 
            this.logger.error(`🚨 Falha na reversão: ${revErr}`); 
            throw new InternalServerErrorException('Erro crítico ao reverter saldo.');
        }
      }
      throw new InternalServerErrorException(e.message || 'Erro no saque.');
    }
  }

  async previewWithdrawal(userId: string, amountInCents: number) {
    const feeInfo = await this.calculateWithdrawalFee(userId, amountInCents);
    return {
      requestedAmount: amountInCents, feePercent: feeInfo.feePercent, feeFixed: feeInfo.feeFixed,
      totalFee: feeInfo.feeInCents, netAmount: feeInfo.netAmountInCents,
      youWillReceive: `R$ ${(feeInfo.netAmountInCents / 100).toFixed(2)}`,
    };
  }
}