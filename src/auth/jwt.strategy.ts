// backend/src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

// Define a interface para o payload do JWT
export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  merchantId?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService, // 🔥 ADICIONA ConfigService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // 🔥 CORREÇÃO CRÍTICA: Usar ConfigService para pegar o JWT_SECRET do .env
      secretOrKey: configService.get<string>('JWT_SECRET') || 'seu_segredo_jwt_aqui_para_testes',
    });
  }

  /**
   * Valida o token JWT.
   */
  async validate(payload: JwtPayload) {
    // Busca o usuário completo no banco de dados
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        merchant: true,
      },
    });

    if (!user) {
      // Se o usuário foi deletado após a emissão do token
      throw new UnauthorizedException('Token inválido ou usuário não encontrado.');
    }
    
    // Retorna o objeto do usuário (o que será injetado pelo @GetUser)
    const { password, ...result } = user;
    return result; // O resultado inclui apiKey e apiSecret
  }
}