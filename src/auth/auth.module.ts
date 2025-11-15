// src/auth/auth.module.ts
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

@Module({
  imports: [
    PrismaModule,
    MailModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secreto_padrao_muito_longo',
      signOptions: { expiresIn: '7d' },
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