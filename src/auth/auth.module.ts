// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordResetController } from './password-reset.controller';
import { TwoFactorController } from './two-factor.controller';
import { ApiCredentialsController } from './api-credentials.controller';
import { PasswordResetService } from './password-reset.service';
import { TwoFactorService } from './two-factor.service';
import { ApiCredentialsService } from './api-credentials.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MailModule } from 'src/mail/mail.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { ApiKeyStrategy } from './api-key.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    PassportModule,
    // 🔥 CORREÇÃO CRÍTICA: Usar ConfigService para pegar o JWT_SECRET do .env
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'seu_segredo_jwt_aqui_para_testes',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    AuthController,
    PasswordResetController,
    TwoFactorController,
    ApiCredentialsController,
  ],
  providers: [
    AuthService,
    PasswordResetService,
    TwoFactorService,
    ApiCredentialsService,
    JwtStrategy,
    ApiKeyStrategy,
  ],
  exports: [
    AuthService,
    PasswordResetService,
    TwoFactorService,
    ApiCredentialsService,
    JwtModule,
  ],
})
export class AuthModule {}