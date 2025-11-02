// src/transactions/transactions.module.ts
import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { KeyclubModule } from 'src/keyclub/keyclub.module';
// Importe o módulo de autenticação para o uso do AuthGuard
import { AuthModule } from 'src/auth/auth.module'; 

@Module({
  imports: [
    PrismaModule, 
    KeyclubModule, 
    AuthModule // Para usar o AuthGuard e o Decorator @GetUser
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}