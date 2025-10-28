// src/merchant/merchant.module.ts
import { Module } from '@nestjs/common';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';
import { PrismaModule } from 'src/prisma/prisma.module'; // 1. IMPORTAR O PRISMA

@Module({
  imports: [PrismaModule], // 2. ADICIONAR O PRISMA NOS IMPORTS
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}