// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport'; // 1. IMPORTAR O PASSPORT
import { JwtStrategy } from './strategy/jwt.strategy'; // 2. IMPORTAR NOSSA STRATEGY

@Module({
  imports: [
    PrismaModule,
    PassportModule, // 3. ADICIONAR O PASSPORTMODULE
    JwtModule.register({
      global: true,
      secret: 'MINHA_CHAVE_SECRETA_PAYLURE_123',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy], // 4. ADICIONAR A STRATEGY NOS PROVIDERS
})
export class AuthModule {}