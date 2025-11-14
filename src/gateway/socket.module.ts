// src/gateway/socket.module.ts
import { Module } from '@nestjs/common';
import { PaymentGateway } from './payment.gateway';

@Module({
  providers: [PaymentGateway],
  exports: [PaymentGateway], // ✅ Exporta para usar em outros módulos
})
export class SocketModule {}