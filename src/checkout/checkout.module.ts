import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { XflowModule } from 'src/xflow/xflow.module'; // ✅ Mudei de Keyclub para Xflow

@Module({
  imports: [PrismaModule, XflowModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}