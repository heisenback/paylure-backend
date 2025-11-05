// src/deposit/deposit.module.ts
import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
// 🚨 ASSUMIMOS QUE ESTES MÓDULOS EXISTEM E EXPORTAM SEUS SERVICES
import { PrismaModule } from 'src/prisma/prisma.module'; 
import { KeyclubModule } from 'src/keyclub/keyclub.module'; 

@Module({
  imports: [
    // 🚨 CORREÇÃO: Imports são obrigatórios para expor PrismaService e KeyclubService
    PrismaModule, 
    KeyclubModule,
  ],
  controllers: [DepositController],
  providers: [DepositService],
  exports: [DepositService], // ✅ CORREÇÃO: Exporta o DepositService
})
export class DepositModule {}