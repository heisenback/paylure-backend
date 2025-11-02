// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';

// Define a interface para o payload do JWT
export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  merchantId?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // 🚨 PONTO CRÍTICO: USE A MESMA CHAVE QUE ESTÁ NO AUTH.MODULE.TS
      secretOrKey: process.env.JWT_SECRET || 'secreto_padrao_muito_longo', 
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