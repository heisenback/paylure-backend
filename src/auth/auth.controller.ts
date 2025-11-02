// src/auth/auth.controller.ts

import { Controller, Get, UseGuards, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from './decorators/get-user.decorator';
// Importa o tipo 'User' corretamente
import type { User } from '@prisma/client'; 

import { AuthService } from './auth.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import { RegisterAuthDto } from './dto/register-auth.dto';

// 🚨 CORREÇÃO DE PREFIXO: Removendo o 'api/' que causava a duplicação
// A rota final será /api/auth ou /api/v1/auth, dependendo do que você quer usar
// Sugestão: Vamos usar 'auth' e o prefixo global do main.ts fará o trabalho.
@Controller('auth') 
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    /**
     * POST /api/auth/register
     */
    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    register(@Body() dto: RegisterAuthDto) {
        return this.authService.register(dto);
    }

    /**
     * POST /api/auth/login
     */
    @Post('login')
    @HttpCode(HttpStatus.OK)
    login(@Body() dto: LoginAuthDto) {
        return this.authService.login(dto);
    }
    
    /**
     * GET /api/auth/me (Perfil do Usuário Logado)
     */
    @Get('me')
    @UseGuards(AuthGuard('jwt')) 
    getProfile(@GetUser() user: User) { 
        // Retorna o usuário que foi validado pelo JwtStrategy
        return { success: true, user: user };
    }
}