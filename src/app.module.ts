// src/app.module.ts

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MerchantModule } from './merchant/merchant.module';
import { PaymentLinkModule } from './payment-link/payment-link.module';
import { DepositModule } from './deposit/deposit.module'; // <-- DEVE ESTAR AQUI

@Module({
  imports: [
    PrismaModule, 
    AuthModule, 
    MerchantModule, 
    PaymentLinkModule,
    DepositModule, // <-- E AQUI!
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}