// src/deposit/deposit.module.ts

import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [DepositController],
  providers: [DepositService, PrismaService],
})
export class DepositModule {}