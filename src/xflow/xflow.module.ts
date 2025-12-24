// src/xflow/xflow.module.ts
import { Module } from '@nestjs/common';
import { XflowService } from './xflow.service';

@Module({
  providers: [XflowService],
  exports: [XflowService],
})
export class XflowModule {}
