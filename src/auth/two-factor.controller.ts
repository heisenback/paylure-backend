// src/auth/two-factor.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TwoFactorService } from './two-factor.service';
import { GetUser } from './decorators/get-user.decorator';
import type { User } from '@prisma/client';
import { IsString, IsEnum } from 'class-validator';

class EnableGoogleAuthDto {
  @IsString()
  verificationCode: string;
}

class VerifyTwoFactorDto {
  @IsString()
  code: string;

  @IsEnum(['EMAIL', 'GOOGLE_AUTH'])
  method: 'EMAIL' | 'GOOGLE_AUTH';
}

@Controller('auth/two-factor')
@UseGuards(AuthGuard('jwt'))
export class TwoFactorController {
  private readonly logger = new Logger(TwoFactorController.name);

  constructor(private readonly twoFactorService: TwoFactorService) {}

  /**
   * GET /api/v1/auth/two-factor/status
   * Obtém status do 2FA
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@GetUser() user: User) {
    this.logger.log(`🔐 Status 2FA para: ${user.email}`);
    return this.twoFactorService.getTwoFactorStatus(user.id);
  }

  /**
   * POST /api/v1/auth/two-factor/enable-email
   * Ativa 2FA por email
   */
  @Post('enable-email')
  @HttpCode(HttpStatus.OK)
  async enableEmail(@GetUser() user: User) {
    this.logger.log(`🔐 Ativando 2FA email para: ${user.email}`);
    return this.twoFactorService.enableEmailTwoFactor(user.id);
  }

  /**
   * POST /api/v1/auth/two-factor/generate-qr
   * Gera QR Code para Google Authenticator
   */
  @Post('generate-qr')
  @HttpCode(HttpStatus.OK)
  async generateQR(@GetUser() user: User) {
    this.logger.log(`🔐 Gerando QR Code para: ${user.email}`);
    return this.twoFactorService.generateGoogleAuthSecret(user.id);
  }

  /**
   * POST /api/v1/auth/two-factor/enable-google-auth
   * Ativa 2FA com Google Authenticator
   */
  @Post('enable-google-auth')
  @HttpCode(HttpStatus.OK)
  async enableGoogleAuth(
    @GetUser() user: User,
    @Body() dto: EnableGoogleAuthDto,
  ) {
    this.logger.log(`🔐 Ativando 2FA Google Auth para: ${user.email}`);
    return this.twoFactorService.enableGoogleAuthTwoFactor(
      user.id,
      dto.verificationCode,
    );
  }

  /**
   * POST /api/v1/auth/two-factor/disable
   * Desativa 2FA
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@GetUser() user: User) {
    this.logger.log(`🔐 Desativando 2FA para: ${user.email}`);
    return this.twoFactorService.disableTwoFactor(user.id);
  }

  /**
   * POST /api/v1/auth/two-factor/send-code
   * Envia código 2FA por email
   */
  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  async sendCode(@GetUser() user: User) {
    this.logger.log(`🔐 Enviando código 2FA para: ${user.email}`);
    return this.twoFactorService.sendEmailTwoFactorCode(user.id);
  }

  /**
   * POST /api/v1/auth/two-factor/verify
   * Verifica código 2FA
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@GetUser() user: User, @Body() dto: VerifyTwoFactorDto) {
    this.logger.log(`🔐 Verificando código 2FA para: ${user.email}`);
    
    const isValid = await this.twoFactorService.verifyTwoFactorCode(
      user.id,
      dto.code,
      dto.method,
    );

    return {
      success: isValid,
      message: isValid ? 'Código verificado com sucesso' : 'Código inválido',
    };
  }
}