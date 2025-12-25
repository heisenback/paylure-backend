import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private isConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const email = this.configService.get<string>('VAPID_EMAIL');

    // 🛡️ PROTEÇÃO CONTRA CRASH: Verifica se as chaves existem antes de iniciar
    if (!publicKey || !privateKey || !email) {
      this.logger.warn('⚠️ VAPID Keys não configuradas no .env. Notificações Push DESATIVADAS.');
      this.isConfigured = false;
      return;
    }

    try {
      webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey);
      this.isConfigured = true;
      this.logger.log('✅ Push Notification Service inicializado com sucesso.');
    } catch (error) {
      this.logger.error('❌ Falha ao configurar WebPush:', error);
      this.isConfigured = false;
    }
  }

  async subscribe(userId: string, subscription: any, deviceInfo?: string) {
    if (!this.isConfigured) return null;

    try {
      const existing = await this.prisma.pushSubscription.findFirst({
        where: { endpoint: subscription.endpoint },
      });

      if (existing) {
        // this.logger.log(`Subscription já existe para usuário ${userId}`);
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
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2021') {
        this.logger.error(
          `P2021: Tabela PushSubscription não existe. Rode as migrations.`,
        );
      }
      this.logger.error('Erro ao salvar subscription', error);
      // Não relança o erro para não quebrar o frontend
      return null;
    }
  }

  async unsubscribe(userId: string, endpoint: string) {
    try {
      await this.prisma.pushSubscription.deleteMany({
        where: { userId, endpoint },
      });
    } catch (error) {
      this.logger.error('Erro ao remover subscription', error);
    }
  }

  async sendNotification(userId: string, payload: any) {
    if (!this.isConfigured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId, isActive: true },
    });

    if (subscriptions.length === 0) return;

    const notificationPayload = JSON.stringify(payload);
    
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            notificationPayload,
          );
        } catch (error: any) {
          if (error.statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
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
      data: { type: 'PIX_GENERATED', amount, pixKey, url: '/dashboard/transactions' },
    });
  }

  async notifyPaymentReceived(userId: string, amount: number, payerName: string) {
    await this.sendNotification(userId, {
      title: '💰 Pagamento Recebido!',
      body: `Você recebeu R$ ${(amount / 100).toFixed(2)} de ${payerName}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'payment-received',
      data: { type: 'PAYMENT_RECEIVED', amount, payerName, url: '/dashboard/transactions' },
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
      data: { type: 'WITHDRAWAL_PROCESSED', amount, status, url: '/dashboard/transactions' },
    });
  }
}