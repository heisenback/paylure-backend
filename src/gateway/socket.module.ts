// src/gateway/socket.module.ts
import { Module } from '@nestjs/common';
import { PaymentGateway } from './payment.gateway';

@Module({
  providers: [PaymentGateway],
  exports: [PaymentGateway], // Exportamos o Gateway para que outros serviços possam notificá-lo
})
export class SocketModule {}