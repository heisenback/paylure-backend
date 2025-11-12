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
import { PushNotificationService } from 'src/push-notification/push-notification.service';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly KEY_CLUB_WEBHOOK_SECRET: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly paymentGateway: PaymentGateway,
    private readonly pushNotificationService: PushNotificationService,
  ) {
    this.KEY_CLUB_WEBHOOK_SECRET = this.configService.get<string>(
      'KEY_CLUB_WEBHOOK_SECRET',
    )!;
    if (!this.KEY_CLUB_WEBHOOK_SECRET) {
      this.logger.error('KEY_CLUB_WEBHOOK_SECRET não definido no .env!');
    }
  }

  verifyKeyClubSignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
    if (!secret || !signature) {
      this.logger.warn('Webhook recebido sem segredo ou assinatura.');
      return false;
    }

    try {
      const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(body);
      const digest = hmac.digest('hex');

      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch (e) {
      this.logger.error('Erro ao validar assinatura', e);
      return false;
    }
  }

  validateSignature(rawBody: Buffer, signature: string): boolean {
    return this.verifyKeyClubSignature(rawBody, signature, this.KEY_CLUB_WEBHOOK_SECRET);
  }

  async handleKeyClubDeposit(token: string, payload: any) {
    const status = (payload.status || '').toUpperCase();
    this.logger.log(`Webhook recebido para o token: ${token} | Status: ${status}`);

    const deposit = await this.prisma.deposit.findUnique({
      where: { webhookToken: token },
      include: { user: true },
    });

    if (!deposit) {
      this.logger.error(`Depósito com token ${token} não encontrado.`);
      throw new NotFoundException('Depósito não encontrado.');
    }

    if (deposit.status === 'PAID') {
      this.logger.log(`Depósito ${deposit.id} já estava PAGO.`);
      return { success: true, message: 'Depósito já processado.' };
    }

    if (status === 'COMPLETED' || status === 'APPROVED') {
      const payloadAmount = parseFloat(payload.data?.amount || payload.amount);
      const depositAmountBRL = deposit.amountInCents / 100;

      if (!isNaN(payloadAmount) && Math.abs(payloadAmount - depositAmountBRL) > 0.01) {
        this.logger.error(
          `Valor do webhook (${payloadAmount}) não bate com o do depósito (${depositAmountBRL})!`,
        );
        throw new BadRequestException('Valor do depósito não confere.');
      }

      const amountInCents = deposit.amountInCents;

      const updatedUser = await this.prisma.$transaction(async (tx) => {
        await tx.deposit.update({
          where: { id: deposit.id },
          data: { status: 'PAID' },
        });

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

      // ✅ EMISSÃO COMPLETA DE EVENTOS WEBSOCKET
      
      // 1. Evento principal: Depósito confirmado (limpa QR Code + mostra banner)
      this.paymentGateway.notifyDepositConfirmed(deposit.userId, {
        depositId: deposit.id,
        amount: amountInCents,
      });
      this.logger.log(`📡 Evento 'deposit:confirmed' emitido para userId: ${deposit.userId}`);

      // 2. Atualização de saldo em tempo real
      this.paymentGateway.notifyBalanceUpdate(deposit.userId, updatedUser.balance);
      this.logger.log(`💰 Evento 'balance:updated' emitido - Novo saldo: R$ ${(updatedUser.balance / 100).toFixed(2)}`);

      // 3. Compatibilidade com sistema legado
      this.paymentGateway.emitDepositUpdate(deposit.externalId, {
        depositId: deposit.id,
        amount: amountInCents / 100,
        status: 'PAID',
      });

      // 📱 PUSH NOTIFICATION - Notifica PWA sobre pagamento recebido
      try {
        await this.pushNotificationService.notifyPaymentReceived(
          deposit.userId,
          amountInCents,
          deposit.payerName,
        );
        this.logger.log(`📲 Push Notification enviada para userId: ${deposit.userId}`);
      } catch (pushError) {
        this.logger.warn(`Falha ao enviar Push Notification: ${pushError.message}`);
      }

      return {
        success: true,
        message: 'Pagamento recebido e saldo atualizado!',
      };
    } else if (['CANCELED', 'REFUNDED', 'FAILED'].includes(status)) {
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: status.toUpperCase() },
      });
      this.logger.warn(`Depósito ${deposit.id} marcado como ${status}.`);
      return { success: true, message: `Status ${status} registrado.` };
    }

    return { success: true, message: 'Status não requer ação.' };
  }

  async handleKeyClubWithdrawal(token: string, payload: any) {
    const status = (payload.status || '').toUpperCase();
    this.logger.log(`Webhook de SAQUE recebido para o token: ${token} | Status: ${status}`);

    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { webhookToken: token },
      include: { user: true },
    });

    if (!withdrawal) {
      this.logger.error(`Saque com token ${token} não encontrado.`);
      throw new NotFoundException('Saque não encontrado.');
    }

    if (['COMPLETED', 'FAILED'].includes(withdrawal.status)) {
      this.logger.log(`Saque ${withdrawal.id} já foi processado com status ${withdrawal.status}.`);
      return { success: true, message: 'Saque já processado.' };
    }

    if (status === 'COMPLETED') {
      await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'COMPLETED' },
      });

      this.logger.log(
        `[SUCESSO] Saque ${withdrawal.id} do Usuário ${withdrawal.user.name} (ID: ${withdrawal.userId}) COMPLETADO com sucesso.`,
      );

      this.paymentGateway.emitWithdrawalUpdate(withdrawal.externalId, {
        withdrawalId: withdrawal.id,
        amount: withdrawal.amount / 100,
        status: 'COMPLETED',
      });

      // 📱 PUSH NOTIFICATION
      try {
        await this.pushNotificationService.notifyWithdrawalProcessed(
          withdrawal.userId,
          withdrawal.amount,
          'COMPLETED',
        );
        this.logger.log(`📲 Push Notification de saque enviada para userId: ${withdrawal.userId}`);
      } catch (pushError) {
        this.logger.warn(`Falha ao enviar Push Notification: ${pushError.message}`);
      }

      return {
        success: true,
        message: 'Saque completado com sucesso!',
      };
    } else if (status === 'FAILED') {
      const amountInCents = withdrawal.amount;
      const failureReason = payload.message || 'Falha reportada pela KeyClub';

      const updatedUser = await this.prisma.$transaction(async (tx) => {
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: 'FAILED',
            failureReason: failureReason.substring(0, 255),
          },
        });

        return tx.user.update({
          where: { id: withdrawal.userId },
          data: {
            balance: {
              increment: amountInCents,
            },
          },
        });
      });

      this.logger.warn(
        `[REVERSÃO] Saque ${withdrawal.id} FALHOU. Saldo de R$ ${(amountInCents / 100).toFixed(2)} revertido para o Usuário ${withdrawal.userId}. Motivo: ${failureReason}`,
      );

      this.paymentGateway.emitWithdrawalUpdate(withdrawal.externalId, {
        withdrawalId: withdrawal.id,
        status: 'FAILED',
        reason: failureReason,
      });

      this.paymentGateway.notifyBalanceUpdate(withdrawal.userId, updatedUser.balance);

      // 📱 PUSH NOTIFICATION
      try {
        await this.pushNotificationService.notifyWithdrawalProcessed(
          withdrawal.userId,
          withdrawal.amount,
          'FAILED',
        );
        this.logger.log(`📲 Push Notification de falha no saque enviada para userId: ${withdrawal.userId}`);
      } catch (pushError) {
        this.logger.warn(`Falha ao enviar Push Notification: ${pushError.message}`);
      }

      return {
        success: true,
        message: 'Saque falhou e saldo foi revertido.',
      };
    }

    return { success: true, message: 'Status não requer ação.' };
  }
}