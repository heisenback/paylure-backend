// src/prisma/prisma.service.ts

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {

  constructor() {
    super({
      // Logar apenas erros de WARNING e ERROR é suficiente para produção
      log: ['warn', 'error'], 
    });
  }

  // Garante que a conexão com o BD seja estabelecida ao iniciar o app
  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma Client conectado ao Banco de Dados.');
    
    // OPCIONAL: Middleware para Hash de Senhas (Vamos pular por enquanto)
    // this.$use(async (params, next) => { ... }); 
  }

  // Garante que a conexão seja encerrada ao fechar o app
  async onModuleDestroy() {
    await this.$disconnect();
    console.log('🔌 Prisma Client desconectado do Banco de Dados.');
  }
}