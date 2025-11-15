// src/deposit/deposit.module.ts
import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { PrismaModule } from 'src/prisma/prisma.module'; // 👈 CORRIGIDO: de 'srcsrc/' para 'src/'
import { KeyclubModule } from 'src/keyclub/keyclub.module'; 
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    PrismaModule, 
    KeyclubModule,
    AuthModule,
  ],
  controllers: [DepositController],
  providers: [DepositService],
  exports: [DepositService],
})
export class DepositModule {}