import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { XflowService } from './xflow.service';
import { XflowController } from './xflow.controller';
import { SocketModule } from '../gateway/socket.module'; [cite_start]// [cite: 1]
import { PrismaService } from '../prisma/prisma.service'; // Assumindo que você tem um global

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    SocketModule
  ],
  controllers: [XflowController],
  providers: [XflowService, PrismaService], // Adicionado PrismaService
  exports: [XflowService],
})
export class XflowModule {}