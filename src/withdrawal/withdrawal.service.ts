// src/withdrawal/withdrawal.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { XflowService } from '../xflow/xflow.service';
import { SystemSettingsService } from 'src/admin/system-settings.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xflowService: XflowService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  // Helper de Taxas
  private async calculateWithdrawalFee(userId: string, amountInCents: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { withdrawalFeePercent: true, withdrawalFeeFixed: true },
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
    if (netAmountInReais < 1) throw new BadRequestException(`Valor líquido mínimo R$ 1,00.`);

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

      // 2. SE FOR AUTOMÁTICO -> Envia e ATUALIZA O STATUS
      if (isAuto && withdrawalRecordId) {
        this.logger.log(`🚀 [Auto] Processando saque automático via XFLOW...`);
        
        // --- ✅ CÓDIGO NOVO XFLOW (CORRIGIDO) ---
        // Adicionado "as string" para o TS não reclamar da comparação com 'EVP'
        const keyTypeXflow = (dto.key_type as string) === 'EVP' ? 'RANDOM' : dto.key_type;

        await this.xflowService.createWithdrawal({
          amount: netAmountInReais, // Float
          externalId: externalId,
          pixKey: dto.pix_key,
          pixKeyType: keyTypeXflow,
          description: dto.description || 'Saque Paylure',
        });

        this.logger.log(`[Withdrawal] ✅ Saque enviado para XFlow. Aguardando webhook.`);

        return {
          success: true,
          message: 'Saque enviado com sucesso.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PROCESSING', 
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
        };

      } else {
        // 3. SE FOR MANUAL
        this.logger.log(`👀 [Manual] Saque retido como PENDING.`);
        return {
          success: true,
          message: 'Aguardando aprovação.',
          transactionId: externalId,
          requestedAmount: requestedAmountInCents,
          status: 'PENDING_APPROVAL',
          fee: feeInfo.feeInCents,
          netAmount: feeInfo.netAmountInCents,
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