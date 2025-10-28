// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get, // 1. IMPORTAR O GET
  UseGuards, // 2. IMPORTAR O "SEGURANÇA" (GUARD)
  Req, // 3. IMPORTAR O "REQUEST" (REQUISIÇÃO)
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { AuthGuard } from '@nestjs/passport'; // 4. IMPORTAR O AuthGuard

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // --- Rota de Cadastro (pública) ---
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterAuthDto) {
    return this.authService.register(dto);
  }

  // --- Rota de Login (pública) ---
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginAuthDto) {
    return this.authService.login(dto);
  }

  // --- 5. NOVA ROTA PROTEGIDA ---
  @UseGuards(AuthGuard('jwt')) // 6. "SEGURANÇA" NA PORTA!
  @Get('me') // A rota será GET /auth/me
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req) {
    // O @Req() pega a "requisição" inteira.
    // A nossa JwtStrategy (Passo 1) já validou o crachá
    // e anexou o usuário em "req.user".
    return req.user;
  }
}