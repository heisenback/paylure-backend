import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { XflowService } from './xflow.service';
import { SocketModule } from '../gateway/socket.module'; 
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    SocketModule
  ],
  controllers: [], // Controller removido pois o WebhooksController já lida com tudo
  providers: [XflowService, PrismaService],
  exports: [XflowService],
})
export class XflowModule {}