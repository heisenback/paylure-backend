// src/withdrawal/withdrawal.module.ts
import { Module } from '@nestjs/common';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { KeyclubModule } from 'src/keyclub/keyclub.module';
import { AdminModule } from 'src/admin/admin.module'; // 👈 ADICIONE ESTA LINHA!

@Module({
  imports: [
    PrismaModule,
    KeyclubModule,
    AdminModule, // 👈 ADICIONE ESTA LINHA!
  ],
  controllers: [WithdrawalController],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}