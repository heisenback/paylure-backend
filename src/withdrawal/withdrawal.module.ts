// src/withdrawal/withdrawal.module.ts
import { Module } from '@nestjs/common';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { KeyclubModule } from 'src/keyclub/keyclub.module';

@Module({
  imports: [
    PrismaModule, 
    KeyclubModule, // Necessário para usar o KeyclubService
  ],
  controllers: [WithdrawalController],
  providers: [WithdrawalService],
})
export class WithdrawalModule {}