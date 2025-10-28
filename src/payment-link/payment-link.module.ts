// src/payment-link/payment-link.module.ts
import { Module } from '@nestjs/common';
import { PaymentLinkController } from './payment-link.controller';
import { PaymentLinkService } from './payment-link.service';
import { PrismaModule } from 'src/prisma/prisma.module'; // 1. IMPORTAR O PRISMA

@Module({
  imports: [PrismaModule], // 2. ADICIONAR O PRISMA NOS IMPORTS
  controllers: [PaymentLinkController],
  providers: [PaymentLinkService],
})
export class PaymentLinkModule {}