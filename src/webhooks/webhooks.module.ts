// src/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { SocketModule } from 'src/gateway/socket.module';
import { PushNotificationModule } from 'src/push-notification/push-notification.module'; // 🔔 NOVO

@Module({
  imports: [
    PrismaModule, 
    ConfigModule,
    SocketModule,
    PushNotificationModule, // 🔔 NOVO
  ], 
  controllers: [], 
  providers: [WebhooksService],
  exports: [WebhooksService], 
})
export class WebhooksModule {}