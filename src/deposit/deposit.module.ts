// src/deposit/deposit.module.ts
import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { KeyclubModule } from 'src/keyclub/keyclub.module';

@Module({
  imports: [
    PrismaModule,
    KeyclubModule,
  ],
  controllers: [DepositController],
  providers: [DepositService],
})
export class DepositModule {}