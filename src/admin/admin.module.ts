// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SystemSettingsService } from './system-settings.service';
import { PrismaModule } from '../prisma/prisma.module';
import { KeyclubModule } from '../keyclub/keyclub.module'; // 👈 Novo Import

@Module({
  imports: [
    PrismaModule,
    KeyclubModule, // 👈 Adicionado para processar saques
  ],
  controllers: [AdminController],
  providers: [AdminService, SystemSettingsService],
  exports: [AdminService, SystemSettingsService],
})
export class AdminModule {}