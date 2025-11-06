// src/push-notification/push-notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY')!;
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY')!;
    const email = this.configService.get<string>('VAPID_EMAIL')!;

    webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey);
    this.logger.log('✅ Push Notification Service inicializado');
  }

  async subscribe(userId: string, subscription: any, deviceInfo?: string) {
    try {
      const existing = await this.prisma.pushSubscription.findUnique({
        where: { endpoint: subscription.endpoint },
      });

      if (existing) {
        this.logger.log(`Subscription já existe para usuário ${userId}`);
        return existing;
      }

      const newSub = await this.prisma.pushSubscription.create({
        data: {
          userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          deviceInfo,
        },
      });

      this.logger.log(`✅ Nova subscription criada para usuário ${userId}`);
      return newSub;
    } catch (error) {
      this.logger.error('Erro ao salvar subscription', error);
      throw error;
    }
  }

  async unsubscribe(userId: string, endpoint: string) {
    try {
      await this.prisma.pushSubscription.deleteMany({
        where: { userId, endpoint },
      });
      this.logger.log(`Subscription removida para usuário ${userId}`);
    } catch (error) {
      this.logger.error('Erro ao remover subscription', error);
    }
  }

  async sendNotification(userId: string, payload: any) {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, isActive: true },
    });

    if (subscriptions.length === 0) {
      this.logger.warn(`Usuário ${userId} não possui subscriptions ativas`);
      return;
    }

    const notificationPayload = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            notificationPayload,
          );
          this.logger.log(`📱 Notificação enviada para ${userId}`);
        } catch (error: any) {
          if (error.statusCode === 410) {
            await this.prisma.pushSubscription.delete({
              where: { id: sub.id },
            });
            this.logger.warn(`Subscription expirada removida: ${sub.id}`);
          } else {
            this.logger.error(`Erro ao enviar push: ${error.message}`);
          }
        }
      }),
    );

    return results;
  }

  async notifyPixGenerated(userId: string, amount: number, pixKey: string) {
    await this.sendNotification(userId, {
      title: '🔑 Pix Gerado!',
      body: `Novo Pix de R$ ${(amount / 100).toFixed(2)} gerado`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'pix-generated',
      data: {
        type: 'PIX_GENERATED',
        amount,
        pixKey,
        url: '/dashboard/transactions',
      },
    });
  }

  async notifyPaymentReceived(userId: string, amount: number, payerName: string) {
    await this.sendNotification(userId, {
      title: '💰 Pagamento Recebido!',
      body: `Você recebeu R$ ${(amount / 100).toFixed(2)} de ${payerName}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'payment-received',
      data: {
        type: 'PAYMENT_RECEIVED',
        amount,
        payerName,
        url: '/dashboard/transactions',
      },
    });
  }

  async notifyWithdrawalProcessed(userId: string, amount: number, status: string) {
    const emoji = status === 'COMPLETED' ? '✅' : '❌';
    const title = status === 'COMPLETED' ? 'Saque Concluído!' : 'Saque Falhou';

    await this.sendNotification(userId, {
      title: `${emoji} ${title}`,
      body: `Saque de R$ ${(amount / 100).toFixed(2)} - Status: ${status}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'withdrawal-processed',
      data: {
        type: 'WITHDRAWAL_PROCESSED',
        amount,
        status,
        url: '/dashboard/transactions',
      },
    });
  }
}