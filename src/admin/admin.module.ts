// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SystemSettingsService } from './system-settings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [AdminService, SystemSettingsService],
  exports: [AdminService, SystemSettingsService], // 👈 ADICIONE SystemSettingsService AQUI!
})
export class AdminModule {}