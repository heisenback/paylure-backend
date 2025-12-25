// src/deposit/deposit.module.ts
import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { XflowModule } from '../xflow/xflow.module'; // ✅ CORREÇÃO: Importando Xflow
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    XflowModule, // <--- Isso resolve o erro "UnknownDependenciesException" do DepositService
    AuthModule,
  ],
  controllers: [DepositController],
  providers: [DepositService],
  exports: [DepositService],
})
export class DepositModule {}