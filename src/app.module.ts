// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantModule } from './merchant/merchant.module';
import { PaymentLinkModule } from './payment-link/payment-link.module'; // 1. IMPORTAR O NOVO MÓDULO

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    MerchantModule,
    PaymentLinkModule, // 2. ADICIONAR ELE AQUI
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}