// src/prisma/prisma.module.ts

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// 🚨 Ajuste Crítico: O decorador @Global()
// Torna o PrismaService disponível para injeção em
// QUALQUER outro módulo, sem precisar importá-lo toda vez.
@Global() 
@Module({
  providers: [PrismaService], // O service que criamos
  exports: [PrismaService],   // Permite que outros módulos o injetem
})
export class PrismaModule {}