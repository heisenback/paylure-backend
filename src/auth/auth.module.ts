// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy'; // Assumindo que você usa JwtStrategy
import { PassportModule } from '@nestjs/passport';
// 🚨 NOVO: Importa a nova estratégia
import { ApiKeyStrategy } from './api-key.strategy'; 

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secreto_padrao_muito_longo',
      signOptions: { expiresIn: '7d' }, // Exemplo
    }),
  ],
  controllers: [AuthController],
  // 🚨 NOVO: Adiciona a ApiKeyStrategy aqui
  providers: [AuthService, JwtStrategy, ApiKeyStrategy], 
  // O AuthModule deve exportar o serviço para que ele seja usado em outros lugares
  exports: [AuthService, JwtModule],
})
export class AuthModule {}