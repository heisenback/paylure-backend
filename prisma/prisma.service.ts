// src/prisma/prisma.service.ts

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {

  async onModuleInit() {
    // Conecta o Prisma Client ao banco de dados ao iniciar o módulo
    await this.$connect();
  }

  async onModuleDestroy() {
    // Fecha a conexão com o banco de dados ao fechar o módulo
    await this.$disconnect();
  }
}