// src/auth/password-reset.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { IsEmail, IsString, MinLength } from 'class-validator';

class RequestPasswordResetDto {
  @IsEmail()
  email: string;
}

class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  newPassword: string;
}

@Controller('auth/password-reset')
export class PasswordResetController {
  private readonly logger = new Logger(PasswordResetController.name);

  constructor(private readonly passwordResetService: PasswordResetService) {}

  /**
   * POST /api/v1/auth/password-reset/request
   * Solicita reset de senha
   */
  @Post('request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    this.logger.log(`🔐 Solicitação de reset para: ${dto.email}`);
    return this.passwordResetService.requestPasswordReset(dto.email);
  }

  /**
   * GET /api/v1/auth/password-reset/validate?token=xxx
   * Valida token de reset
   */
  @Get('validate')
  @HttpCode(HttpStatus.OK)
  async validateToken(@Query('token') token: string) {
    this.logger.log(`🔐 Validando token de reset`);
    
    if (!token) {
      return { valid: false, message: 'Token não fornecido' };
    }

    const result = await this.passwordResetService.validateResetToken(token);
    
    return {
      valid: result.valid,
      email: result.email,
      message: result.valid ? 'Token válido' : 'Token inválido ou expirado',
    };
  }

  /**
   * POST /api/v1/auth/password-reset/reset
   * Reseta a senha
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    this.logger.log(`🔐 Resetando senha`);
    return this.passwordResetService.resetPassword(dto.token, dto.newPassword);
  }
}