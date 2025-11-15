// src/auth/api-credentials.controller.ts
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
import { ApiCredentialsService } from './api-credentials.service';
import { GetUser } from './decorators/get-user.decorator';
import type { User } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';

class RegenerateCredentialsDto {
  @IsBoolean()
  @IsOptional()
  sendEmail?: boolean = true;
}

@Controller('auth/api-credentials')
@UseGuards(AuthGuard('jwt'))
export class ApiCredentialsController {
  private readonly logger = new Logger(ApiCredentialsController.name);

  constructor(private readonly apiCredentialsService: ApiCredentialsService) {}

  /**
   * GET /api/v1/auth/api-credentials
   * Obtém apenas a API Key (sem o secret)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getApiKey(@GetUser() user: User) {
    this.logger.log(`🔑 Buscando API Key para: ${user.email}`);
    return this.apiCredentialsService.getApiKey(user.id);
  }

  /**
   * POST /api/v1/auth/api-credentials/regenerate
   * Gera novas credenciais (INVALIDA as antigas)
   */
  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerate(
    @GetUser() user: User,
    @Body() dto: RegenerateCredentialsDto,
  ) {
    this.logger.log(`🔑 Regenerando credenciais para: ${user.email}`);
    
    const sendEmail = dto.sendEmail !== undefined ? dto.sendEmail : true;
    
    return this.apiCredentialsService.regenerateCredentials(user.id, sendEmail);
  }
}