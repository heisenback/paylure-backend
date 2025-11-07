// src/keyclub/keyclub.module.ts
import { Module } from '@nestjs/common';
import { KeyclubService } from './keyclub.service';
import { KeyclubController } from './keyclub.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  controllers: [KeyclubController],
  providers: [KeyclubService],
  exports: [KeyclubService],
})
export class KeyclubModule {}