// src/auth/strategy/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      // 1. Onde procurar o "crachá" (no cabeçalho de autorização)
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // 2. Não ignorar se o crachá estiver expirado (a biblioteca cuida disso)
      ignoreExpiration: false,
      // 3. A SENHA SECRETA (TEM QUE SER A MESMA DO AUTH.MODULE.TS)
      secretOrKey: 'MINHA_CHAVE_SECRETA_PAYLURE_123',
    });
  }

  // 4. Esta função roda DEPOIS que o crachá é validado
  // Ela nos dá os dados que guardamos dentro do crachá (o "payload")
  async validate(payload: { sub: string; email: string; name: string }) {
    // Vamos checar no banco se o usuário do crachá ainda existe
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    // 5. CORREÇÃO: Remover a senha antes de "anexar" o usuário
    const { password, ...result } = user;
    return result; // Retorna o objeto "result" (sem a senha)
  }
}