// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // 🚨 Importante: Torna o PrismaService disponível em qualquer outro módulo.
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // 🚨 CRUCIAL: Exporta o serviço para que o DepositModule possa usá-lo
})
export class PrismaModule {}