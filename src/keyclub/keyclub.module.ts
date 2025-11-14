// src/keyclub/keyclub.module.ts
import { Module } from '@nestjs/common';
import { KeyclubService } from './keyclub.service';

@Module({
  controllers: [],
  providers: [KeyclubService],
  exports: [KeyclubService],
})
export class KeyclubModule {}