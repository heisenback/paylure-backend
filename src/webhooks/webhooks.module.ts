// src/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { SocketModule } from 'src/gateway/socket.module'; 

@Module({
  imports: [
    PrismaModule, 
    ConfigModule,
    SocketModule, // Para injetar o PaymentGateway
  ], 
  // CORREÇÃO: Removido o import do Controller que não existe nesta pasta!
  controllers: [], 
  providers: [WebhooksService],
  // Exportamos o Service para que o KeyclubModule possa injetá-lo
  exports: [WebhooksService], 
})
export class WebhooksModule {}