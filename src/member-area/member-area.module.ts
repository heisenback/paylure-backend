// src/member-area/member-area.module.ts
import { Module } from '@nestjs/common';
import { MemberAreaController } from './member-area.controller';
import { MemberAreaService } from './member-area.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MemberAreaController],
  providers: [MemberAreaService],
  exports: [MemberAreaService],
})
export class MemberAreaModule {}