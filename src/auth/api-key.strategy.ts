// src/auth/api-key.strategy.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * Método de validação da estratégia de API Key.
   * Procura a chave no cabeçalho 'x-api-key' e a chave secreta no cabeçalho 'x-api-secret'.
   */
  async validate(req: Request): Promise<any> {
    const apiKey = req.headers['x-api-key'] as string;
    const apiSecret = req.headers['x-api-secret'] as string;
    
    if (!apiKey || !apiSecret) {
      this.logger.warn('Tentativa de acesso à API sem chaves.');
      throw new UnauthorizedException('Chaves de API (x-api-key e x-api-secret) ausentes.');
    }

    // 1. Busca o usuário pela API Key (chave pública)
    const user = await this.prisma.user.findUnique({
      where: { apiKey: apiKey },
      // Incluímos o Merchant, pois ele é necessário para criar a transação
      include: {
        merchant: true,
      },
    });

    if (!user) {
      this.logger.warn(`API Key inválida: ${apiKey}`);
      throw new UnauthorizedException('API Key inválida.');
    }

    // 2. Valida a chave secreta (API Secret)
    // Usamos `==` para comparação simples, mas o ideal em produção seria um hash comparision (secreto).
    if (user.apiSecret !== apiSecret) {
      this.logger.warn(`API Secret inválida para o usuário: ${user.email}`);
      throw new UnauthorizedException('API Secret inválida.');
    }

    // Se as chaves estiverem corretas, retornamos o objeto do usuário (com o merchant incluído)
    // O objeto retornado será injetado no @GetUser() do controller.
    this.logger.log(`Autenticação de API Key bem-sucedida para o usuário: ${user.email}`);
    
    // Retornamos o objeto completo para uso no controller
    return user; 
  }
}