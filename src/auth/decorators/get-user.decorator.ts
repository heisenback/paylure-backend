// src/auth/decorators/get-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Decorator customizado para extrair o usuário (User)
 * injetado na requisição pelo AuthGuard (JWT Strategy).
 * * Uso: @GetUser() user: User
 */
export const GetUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    // Captura o objeto de requisição HTTP
    const request: Request = ctx.switchToHttp().getRequest();
    // Retorna o objeto 'user' que foi anexado à requisição pelo Passport/JWT Strategy
    return request.user;
  },
);