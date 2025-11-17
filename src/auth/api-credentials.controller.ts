// src/auth/api-credentials.controller.ts
import {
  Controller,
  Post,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCredentialsService } from './api-credentials.service';
import { GetUser } from './decorators/get-user.decorator';
import type { User } from '@prisma/client';

@Controller('auth')
@UseGuards(AuthGuard('jwt'))
export class ApiCredentialsController {
  private readonly logger = new Logger(ApiCredentialsController.name);

  constructor(private readonly apiCredentialsService: ApiCredentialsService) {
    this.logger.log('✅ ApiCredentialsController inicializado!');
    this.logger.log('🔍 Rotas disponíveis:');
    this.logger.log('   GET  /api/v1/auth/me');
    this.logger.log('   POST /api/v1/auth/regenerate-credentials');
    this.logger.log('   POST /api/v1/auth/send-credentials-email');
  }

  /**
   * GET /api/v1/auth/me
   * Retorna dados do usuário incluindo client_id
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@GetUser() user: User) {
    this.logger.log(`📋 GET /auth/me - User: ${user.email}`);
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      client_id: user.apiKey,
      client_secret: user.apiSecret ? 'configured' : null,
      balance: user.balance,
      createdAt: user.createdAt,
    };
  }

  /**
   * POST /api/v1/auth/regenerate-credentials
   * Gera novas credenciais (INVALIDA as antigas)
   */
  @Post('regenerate-credentials')
  @HttpCode(HttpStatus.OK)
  async regenerateCredentials(@GetUser() user: User) {
    this.logger.log(`🔄 POST /auth/regenerate-credentials - User: ${user.email}`);
    
    try {
      const result = await this.apiCredentialsService.regenerateCredentials(
        user.id,
        false
      );

      this.logger.log(`✅ Credenciais regeneradas - User: ${user.email}`);

      return {
        success: true,
        client_id: result.apiKey,
        client_secret: result.apiSecret,
        message: result.message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao regenerar credenciais: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /api/v1/auth/send-credentials-email
   * Envia credenciais atuais por email
   */
  @Post('send-credentials-email')
  @HttpCode(HttpStatus.OK)
  async sendCredentialsEmail(@GetUser() user: User) {
    this.logger.log(`📧 POST /auth/send-credentials-email - User: ${user.email}`);
    
    if (!user.apiKey || !user.apiSecret) {
      return {
        success: false,
        message: 'Você ainda não possui credenciais. Gere novas credenciais primeiro.',
      };
    }

    try {
      await this.apiCredentialsService.sendCredentialsReminder(user.id);

      return {
        success: true,
        message: 'Email enviado com sucesso!',
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar email: ${error.message}`);
      return {
        success: false,
        message: 'Erro ao enviar email. Tente novamente.',
      };
    }
  }
}