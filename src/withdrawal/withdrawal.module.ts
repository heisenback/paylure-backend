import { Module } from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';
import { WithdrawalController } from './withdrawal.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { XflowModule } from '../xflow/xflow.module'; // ✅ Importação Essencial
import { AdminModule } from 'src/admin/admin.module'; // Necessário para o SystemSettingsService

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    XflowModule, // <--- O PULO DO GATO: Disponibiliza o XflowService
    AdminModule, // <--- Importa o módulo que exporta o SystemSettingsService
  ],
  controllers: [WithdrawalController],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}