// src/deposit/deposit.module.ts
import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { PrismaModule } from 'srcsrc/prisma/prisma.module'; 
import { KeyclubModule } from 'src/keyclub/keyclub.module'; 
import { AuthModule } from 'src/auth/auth.module'; // 👈 1. IMPORTAR O AuthModule

@Module({
  imports: [
    PrismaModule, 
    KeyclubModule,
    AuthModule, // 👈 2. ADICIONAR O AuthModule AQUI
  ],
  controllers: [DepositController],
  providers: [DepositService],
  exports: [DepositService],
})
export class DepositModule {}