// src/webhooks/webhooks.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from 'src/gateway/payment.gateway';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly KEY_CLUB_WEBHOOK_SECRET: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly paymentGateway: PaymentGateway, // ⭐ Injetar WebSocket Gateway
  ) {
    this.KEY_CLUB_WEBHOOK_SECRET = this.configService.get<string>(
      'KEY_CLUB_WEBHOOK_SECRET',
    )!;
    if (!this.KEY_CLUB_WEBHOOK_SECRET) {
      this.logger.error('KEY_CLUB_WEBHOOK_SECRET não definido no .env!');
    }
  }

  /**
   * Valida a assinatura HMAC do webhook da KeyClub
   */
  validateSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.KEY_CLUB_WEBHOOK_SECRET || !signature) {
      this.logger.warn('Webhook recebido sem segredo ou assinatura.');
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', this.KEY_CLUB_WEBHOOK_SECRET);
      hmac.update(rawBody);
      const digest = hmac.digest('hex');

      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch (e) {
      this.logger.error('Erro ao validar assinatura', e);
      return false;
    }
  }

  /**
   * Processa o evento de DEPÓSITO da KeyClub.
   */
  async handleKeyClubDeposit(token: string, payload: any) {
    const status = (payload.status || '').toUpperCase();
    this.logger.log(`Webhook recebido para o token: ${token} | Status: ${status}`);

    // 1. Encontrar o depósito no banco usando o token único
    const deposit = await this.prisma.deposit.findUnique({
      where: { webhookToken: token },
      include: { user: true },
    });

    if (!deposit) {
      this.logger.error(`Depósito com token ${token} não encontrado.`);
      throw new NotFoundException('Depósito não encontrado.');
    }

    // 2. Se o depósito já foi pago, não faz nada
    if (deposit.status === 'PAID') {
      this.logger.log(`Depósito ${deposit.id} já estava PAGO.`);
      return { success: true, message: 'Depósito já processado.' };
    }

    // 3. Se o pagamento foi COMPLETO ou APROVADO
    if (status === 'COMPLETED' || status === 'APPROVED') {
      const payloadAmount = parseFloat(payload.data?.amount || payload.amount);

      // Validação do valor em BRL (KeyClub envia em BRL)
      const depositAmountBRL = deposit.amountInCents / 100;

      if (!isNaN(payloadAmount) && Math.abs(payloadAmount - depositAmountBRL) > 0.01) {
        this.logger.error(
          `Valor do webhook (${payloadAmount}) não bate com o do depósito (${depositAmountBRL})!`,
        );
        throw new BadRequestException('Valor do depósito não confere.');
      }

      // 4. ATUALIZAR O SALDO DO USUÁRIO (valor em CENTAVOS)
      const amountInCents = deposit.amountInCents;

      const updatedUser = await this.prisma.$transaction(async (tx) => {
        // Operação 1: Atualiza o status do Depósito
        await tx.deposit.update({
          where: { id: deposit.id },
          data: { status: 'PAID' },
        });

        // Operação 2: Incrementa o saldo no modelo User
        return tx.user.update({
          where: { id: deposit.userId },
          data: {
            balance: {
              increment: amountInCents,
            },
          },
        });
      });

      this.logger.log(
        `[SUCESSO] Saldo do Usuário ${deposit.user.name} (ID: ${deposit.userId}) atualizado em +${amountInCents} centavos (R$ ${(amountInCents / 100).toFixed(2)}).`,
      );

      // ⭐ Notifica o frontend via WebSocket
      this.paymentGateway.notifyDepositConfirmed(deposit.userId, {
        depositId: deposit.id,
        amount: amountInCents / 100,
      });

      this.paymentGateway.notifyBalanceUpdate(deposit.userId, updatedUser.balance / 100);

      return {
        success: true,
        message: 'Pagamento recebido e saldo atualizado!',
      };
    } else if (['CANCELED', 'REFUNDED', 'FAILED'].includes(status)) {
      // 5. Se o PIX foi cancelado ou falhou
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: status.toUpperCase() },
      });
      this.logger.warn(`Depósito ${deposit.id} marcado como ${status}.`);
      return { success: true, message: `Status ${status} registrado.` };
    }

    return { success: true, message: 'Status não requer ação.' };
  }

  /**
   * Processa o evento de SAQUE (Withdrawal) da KeyClub.
   */
  async handleKeyClubWithdrawal(token: string, payload: any) {
    const status = (payload.status || '').toUpperCase();
    this.logger.log(`Webhook de SAQUE recebido para o token: ${token} | Status: ${status}`);

    // 1. Encontrar o saque no banco usando o token único
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { webhookToken: token },
      include: { user: true },
    });

    if (!withdrawal) {
      this.logger.error(`Saque com token ${token} não encontrado.`);
      throw new NotFoundException('Saque não encontrado.');
    }

    // 2. Se o saque já foi processado, não faz nada
    if (['COMPLETED', 'FAILED'].includes(withdrawal.status)) {
      this.logger.log(`Saque ${withdrawal.id} já foi processado com status ${withdrawal.status}.`);
      return { success: true, message: 'Saque já processado.' };
    }

    // 3. Se o saque foi COMPLETADO com sucesso
    if (status === 'COMPLETED') {
      await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'COMPLETED' },
      });

      this.logger.log(
        `[SUCESSO] Saque ${withdrawal.id} do Usuário ${withdrawal.user.name} (ID: ${withdrawal.userId}) COMPLETADO com sucesso.`,
      );

      // ⭐ Notifica o frontend via WebSocket
      this.paymentGateway.notifyWithdrawalCompleted(withdrawal.userId, {
        withdrawalId: withdrawal.id,
        amount: withdrawal.amount / 100,
      });

      return {
        success: true,
        message: 'Saque completado com sucesso!',
      };
    } else if (status === 'FAILED') {
      // 4. Se o saque FALHOU, precisamos REVERTER o saldo
      const amountInCents = withdrawal.amount;
      const failureReason = payload.message || 'Falha reportada pela KeyClub';

      const updatedUser = await this.prisma.$transaction(async (tx) => {
        // Operação 1: Marca o saque como FAILED
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: 'FAILED',
            failureReason: failureReason.substring(0, 255),
          },
        });

        // Operação 2: REVERTE o saldo do usuário
        return tx.user.update({
          where: { id: withdrawal.userId },
          data: {
            balance: {
              increment: amountInCents, // Devolve o valor
            },
          },
        });
      });

      this.logger.warn(
        `[REVERSÃO] Saque ${withdrawal.id} FALHOU. Saldo de R$ ${(amountInCents / 100).toFixed(2)} revertido para o Usuário ${withdrawal.userId}. Motivo: ${failureReason}`,
      );

      // ⭐ Notifica o frontend via WebSocket
      this.paymentGateway.notifyWithdrawalFailed(withdrawal.userId, {
        withdrawalId: withdrawal.id,
        reason: failureReason,
      });

      this.paymentGateway.notifyBalanceUpdate(withdrawal.userId, updatedUser.balance / 100);

      return {
        success: true,
        message: 'Saque falhou e saldo foi revertido.',
      };
    }

    return { success: true, message: 'Status não requer ação.' };
  }
}