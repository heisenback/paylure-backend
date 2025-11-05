// src/api/public-api.module.ts
import { Module } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { DepositModule } from 'src/deposit/deposit.module';
import { WithdrawalModule } from 'src/withdrawal/withdrawal.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { ProductModule } from 'src/product/product.module';

@Module({
  imports: [
    PrismaModule,
    DepositModule,
    WithdrawalModule,
    TransactionsModule,
    ProductModule,
  ],
  controllers: [PublicApiController],
})
export class PublicApiModule {}