import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,  // 👈 Módulo do Prisma
    AuthModule,    // 👈 MÓDULO DE AUTENTICAÇÃO (estava faltando!)
    // Adicione outros módulos aqui conforme necessário
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}