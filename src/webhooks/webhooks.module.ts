// src/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { SocketModule } from 'src/gateway/socket.module';
import { PushNotificationModule } from 'src/push-notification/push-notification.module';
import { WebhooksController } from './webhooks.controller';
import { MailModule } from 'src/mail/mail.module'; // <--- 1. VERIFIQUE SE ESTÁ IMPORTADO AQUI

@Module({
  imports: [
    PrismaModule, 
    ConfigModule,
    SocketModule,
    PushNotificationModule,
    MailModule, // <--- 2. OBRIGATÓRIO ESTAR AQUI DENTRO DE IMPORTS
  ], 
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService], 
})
export class WebhooksModule {}