// src/sales/sales.module.ts
import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { TransactionsModule } from 'src/transactions/transactions.module'; // Importa o serviço que tem o histórico

@Module({
  imports: [PrismaModule, AuthModule, TransactionsModule],
  providers: [SalesService],
  controllers: [SalesController],
  exports: [SalesService],
})
export class SalesModule {}