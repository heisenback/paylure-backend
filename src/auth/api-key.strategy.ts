// src/auth/api-key.strategy.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

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
      include: {
        merchant: true,
      },
    });

    if (!user) {
      this.logger.warn(`API Key inválida: ${apiKey}`);
      throw new UnauthorizedException('API Key inválida.');
    }

    // 2. ✅ CORREÇÃO: Valida a chave secreta usando bcrypt.compare
    const isSecretValid = await bcrypt.compare(apiSecret, user.apiSecret);

    if (!isSecretValid) {
      this.logger.warn(`API Secret inválida para o usuário: ${user.email}`);
      throw new UnauthorizedException('API Secret inválida.');
    }

    // 3. ✅ REMOVIDO: Verificação de isBanned (campo não existe)
    // Se você quiser adicionar essa funcionalidade, precisa adicionar o campo no schema.prisma primeiro

    this.logger.log(`✅ Autenticação de API Key bem-sucedida para: ${user.email}`);
    
    // Remove dados sensíveis antes de retornar
    const { password, apiSecret: secret, ...userWithoutSensitiveData } = user;
    
    return userWithoutSensitiveData; 
  }
}