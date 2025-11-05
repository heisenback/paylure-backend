// src/auth/guards/api-key.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * Guard para autenticação via API Key (Client ID/Secret).
 * 
 * Usado para endpoints públicos de API onde clientes externos
 * usam suas credenciais ao invés de JWT.
 * 
 * Exemplo de uso:
 * @UseGuards(ApiKeyGuard)
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Extrai as credenciais do header Authorization
    const authHeader = request.headers['authorization'];
    
    if (!authHeader) {
      throw new UnauthorizedException('Credenciais de API ausentes. Use: Authorization: ApiKey client_id:client_secret');
    }

    // Formato esperado: "ApiKey client_id:client_secret"
    const [type, credentials] = authHeader.split(' ');
    
    if (type !== 'ApiKey' || !credentials) {
      throw new UnauthorizedException('Formato inválido. Use: Authorization: ApiKey client_id:client_secret');
    }

    const [clientId, clientSecret] = credentials.split(':');
    
    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('Client ID e Client Secret são obrigatórios.');
    }

    // Busca o usuário no banco de dados
    const user = await this.prisma.user.findUnique({
      where: { apiKey: clientId },
      include: {
        merchant: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Client ID inválido.');
    }

    // Valida o Client Secret (comparação segura)
    const isSecretValid = await bcrypt.compare(clientSecret, user.apiSecret);
    
    if (!isSecretValid) {
      throw new UnauthorizedException('Client Secret inválido.');
    }

    // Verifica se a conta está ativa
    if (user.isBanned) {
      throw new UnauthorizedException('Conta banida. Entre em contato com o suporte.');
    }

    // Anexa o usuário à requisição (disponível em @GetUser() nos controllers)
    request.user = user;
    
    return true;
  }
}