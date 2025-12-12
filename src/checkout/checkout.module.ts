import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { KeyclubModule } from 'src/keyclub/keyclub.module'; // ✅ Importante

@Module({
  imports: [PrismaModule, KeyclubModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}