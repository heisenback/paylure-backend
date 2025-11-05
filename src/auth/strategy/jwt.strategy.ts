// src/auth/strategy/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      // 1. Onde procurar o token (no cabeçalho Authorization: Bearer)
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      
      // 2. Não ignorar se o token estiver expirado
      ignoreExpiration: false,
      
      // 3. CORREÇÃO: Usar variável de ambiente (mesma do auth.module.ts)
      secretOrKey: process.env.JWT_SECRET || 'MINHA_CHAVE_SECRETA_PAYLURE_123',
    });
  }

  // 4. Esta função roda DEPOIS que o token é validado
  async validate(payload: { sub: string; email: string; name: string; merchantId?: string }) {
    // Busca o usuário no banco incluindo o merchant
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        merchant: true, // ⭐ INCLUIR MERCHANT (necessário para API)
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado ou token inválido.');
    }

    // 5. Remove a senha antes de retornar (segurança)
    const { password, ...userWithoutPassword } = user;
    
    return userWithoutPassword; // Retorna usuário completo COM merchant (sem senha)
  }
}