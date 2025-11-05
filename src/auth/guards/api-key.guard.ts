import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    
    if (!authHeader) {
      throw new UnauthorizedException(
        'Credenciais de API ausentes. Use: Authorization: ApiKey client_id:client_secret'
      );
    }

    const [type, credentials] = authHeader.split(' ');
    
    if (type !== 'ApiKey' || !credentials) {
      throw new UnauthorizedException(
        'Formato inválido. Use: Authorization: ApiKey client_id:client_secret'
      );
    }

    const [clientId, clientSecret] = credentials.split(':');
    
    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('Client ID e Client Secret são obrigatórios.');
    }

    const user = await this.prisma.user.findUnique({
      where: { apiKey: clientId },
      include: { merchant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Client ID inválido.');
    }

    const isSecretValid = await bcrypt.compare(clientSecret, user.apiSecret);
    
    if (!isSecretValid) {
      throw new UnauthorizedException('Client Secret inválido.');
    }

    request.user = user;
    return true;
  }
}