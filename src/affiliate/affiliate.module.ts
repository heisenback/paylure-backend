// src/affiliate/affiliate.module.ts
import { Module } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AffiliateController } from './affiliate.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [AffiliateService],
  controllers: [AffiliateController],
  exports: [AffiliateService],
})
export class AffiliateModule {}