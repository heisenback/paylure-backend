// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { KeyclubModule } from './keyclub/keyclub.module';
import { DepositModule } from './deposit/deposit.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { MerchantModule } from './merchant/merchant.module';
import { PaymentLinkModule } from './payment-link/payment-link.module';
import { WebhooksModule } from './webhooks/webhooks.module';
// Removidos: WithdrawalModule, TransactionsModule, ProductModule, etc., pois são undefined.
// Você pode adicioná-los de volta assim que criar seus arquivos de módulo!
// Por enquanto, vamos manter apenas os módulos principais.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    MerchantModule,
    PaymentLinkModule,
    
    // Módulos da Gateway
    KeyclubModule,
    DepositModule,
    WebhooksModule,
    
    // Módulos que parecem estar completos:
    // WithdrawalModule, // Adicione este de volta se o arquivo existir!
    // TransactionsModule, // Adicione este de volta se o arquivo existir!
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}