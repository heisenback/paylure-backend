// src/push-notification/push-notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as webPush from 'web-push';

function pickEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private initialized = false;

  constructor() {
    const subject =
      pickEnv('VAPID_SUBJECT', 'WEB_PUSH_SUBJECT') ||
      (process.env.VAPID_EMAIL ? `mailto:${process.env.VAPID_EMAIL}` : undefined);

    const publicKey = pickEnv('VAPID_PUBLIC_KEY', 'WEB_PUSH_PUBLIC_KEY');
    const privateKey = pickEnv('VAPID_PRIVATE_KEY', 'WEB_PUSH_PRIVATE_KEY');

    if (!subject) {
      throw new Error(
        'Push VAPID: subject ausente. Defina VAPID_EMAIL (ou VAPID_SUBJECT/WEB_PUSH_SUBJECT) no .env.'
      );
    }
    if (!publicKey) {
      throw new Error(
        'Push VAPID: public key ausente. Defina VAPID_PUBLIC_KEY (ou WEB_PUSH_PUBLIC_KEY) no .env.'
      );
    }
    if (!privateKey) {
      throw new Error(
        'Push VAPID: private key ausente. Defina VAPID_PRIVATE_KEY (ou WEB_PUSH_PRIVATE_KEY) no .env.'
      );
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);
    this.initialized = true;
    this.logger.log('PushNotificationService inicializado com VAPID.');
  }

  async subscribe(userId: string, subscription: webPush.PushSubscription) {
    // TODO: persista a subscription no seu DB (userId -> endpoint, keys, etc.)
    this.logger.log(`Subscrição salva para user=${userId} endpoint=${subscription.endpoint}`);
    return { success: true };
  }

  /**
   * Tornamos 'endpoint' opcional para compatibilizar com o controller
   * que chama unsubscribe(userId) com 1 argumento.
   */
  async unsubscribe(userId: string, endpoint?: string) {
    // TODO: se endpoint vier, remova só aquele; se não vier, remova todas as subscriptions do user.
    if (endpoint) {
      this.logger.log(`Unsubscribe específico: user=${userId} endpoint=${endpoint}`);
    } else {
      this.logger.log(`Unsubscribe geral: removendo todas as subscriptions de user=${userId}`);
    }
    return { success: true };
  }

  async sendNotification(subscription: webPush.PushSubscription, payload: unknown) {
    if (!this.initialized) {
      throw new Error('PushNotificationService não inicializado.');
    }
    const data = JSON.stringify(payload ?? {});
    return webPush.sendNotification(subscription, data);
  }
}
