// src/auth/guards/admin.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AdminGuard implements CanActivate {
  // 🎯 SEU EMAIL (Admin Master)
  private readonly ADMIN_EMAIL = 'joaobraz.ofc@gmail.com';
  
  // 🎯 SUPORTE (Futuro - Deixe vazio por enquanto)
  private readonly SUPPORT_EMAILS: string[] = [];

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    // Verifica se é o admin master
    if (user.email === this.ADMIN_EMAIL) {
      request.user.role = 'ADMIN'; // Adiciona role no request
      return true;
    }

    // Verifica se é suporte (futuro)
    if (this.SUPPORT_EMAILS.includes(user.email)) {
      request.user.role = 'SUPPORT';
      return true;
    }

    // Verifica se tem role ADMIN no banco
    if (user.role === 'ADMIN') {
      return true;
    }

    throw new ForbiddenException('Acesso negado. Apenas administradores.');
  }
}

// 🎯 DECORATOR PARA ROLES ESPECÍFICAS (Futuro)
export const Roles = Reflector.createDecorator<string[]>();