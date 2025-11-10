// src/auth/auth.controller.ts
import { 
  Controller, 
  Get, 
  UseGuards, 
  Post, 
  Body, 
  HttpCode, 
  HttpStatus,
  Logger,
  Req
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from './decorators/get-user.decorator';
import type { User } from '@prisma/client'; 
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import { RegisterAuthDto } from './dto/register-auth.dto';

@Controller('auth') 
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(private readonly authService: AuthService) {
        this.logger.log('🎯 AuthController inicializado');
    }

    /**
     * POST /api/v1/auth/register
     */
    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    async register(@Body() dto: RegisterAuthDto, @Req() req: Request) {
        this.logger.log('📝 ========================================');
        this.logger.log(`📝 POST /auth/register`);
        this.logger.log(`📧 Email: ${dto.email}`);
        this.logger.log(`🌐 Origin: ${req.headers.origin}`);
        this.logger.log('📝 ========================================');
        
        try {
            const result = await this.authService.register(dto);
            this.logger.log(`✅ Registro bem-sucedido: ${dto.email}`);
            return result;
        } catch (error) {
            this.logger.error(`❌ Erro no registro: ${error.message}`);
            throw error;
        }
    }

    /**
     * POST /api/v1/auth/login
     */
    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginAuthDto, @Req() req: Request) {
        this.logger.log('🔐 ========================================');
        this.logger.log(`🔐 POST /auth/login`);
        this.logger.log(`📧 Email: ${dto.email}`);
        this.logger.log(`🌐 Origin: ${req.headers.origin}`);
        this.logger.log(`📍 URL completa: ${req.url}`);
        this.logger.log(`🔧 Method: ${req.method}`);
        this.logger.log('🔐 ========================================');
        
        try {
            const result = await this.authService.login(dto);
            this.logger.log(`✅ Login bem-sucedido: ${dto.email}`);
            return result;
        } catch (error) {
            this.logger.error(`❌ Erro no login: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * GET /api/v1/auth/me (Perfil do Usuário Logado)
     */
    @Get('me')
    @UseGuards(AuthGuard('jwt')) 
    getProfile(@GetUser() user: User) { 
        this.logger.log(`👤 Perfil acessado: ${user.email}`);
        return { success: true, user: user };
    }
}
