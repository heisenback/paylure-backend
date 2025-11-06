// src/keyclub/keyclub.module.ts
import { Module } from '@nestjs/common';
import { KeyclubService } from './keyclub.service';
import { KeyclubController } from './keyclub.controller';
import { WebhooksModule } from 'src/webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  providers: [KeyclubService],
  controllers: [KeyclubController],
  exports: [KeyclubService],
})
export class KeyclubModule {}
