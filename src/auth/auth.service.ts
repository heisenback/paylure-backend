// src/auth/auth.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login-auth.dto';
import * as uuid from 'uuid';
import * as crypto from 'crypto';

/**
 * Gera uma API Key única no formato: paylure_XXXXXXXXXXXX
 */
function generateApiKey(): string {
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `paylure_${randomPart}`;
}

/**
 * 🚨 CORREÇÃO: O comentário foi alterado para evitar o falso positivo do GitHub.
 * Gera um API Secret forte (ex: sk_live_[REMOVIDO_PARA_SEGURANCA])
 */
function generateApiSecret(): string {
  const randomPart = crypto.randomBytes(32).toString('hex');
  return `sk_live_${randomPart}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterAuthDto) {
    // 1. Verifica se o email já existe
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    // 2. Gera CNPJ único e nome padrão da loja
    const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14);
    const defaultStoreName = `Loja-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 3. Gera credenciais de API
    const apiKey = generateApiKey(); // paylure_abc123...
    const apiSecret = generateApiSecret(); // sk_live_xyz789...

    // 4. Hash da senha e do API Secret
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);
    const hashedApiSecret = await bcrypt.hash(apiSecret, salt);

    try {
      // 5. Cria usuário com merchant e credenciais
      const userWithMerchant = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name || 'Usuário Padrão',
          document: dto.document || null, // ✅ SALVA O CPF/CNPJ DO USUÁRIO
          password: hashedPassword,
          apiKey: apiKey, // Client ID (público)
          apiSecret: hashedApiSecret, // Client Secret (hash, nunca mostrado novamente)
          merchant: {
            create: {
              storeName: defaultStoreName,
              cnpj: uniqueCnpj,
            },
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          document: true, // ✅ RETORNA O DOCUMENT NO RESPONSE
          createdAt: true,
          updatedAt: true,
          merchant: true,
          apiKey: true,
          // ⚠️ NÃO retornar apiSecret hasheado
        },
      });

      const { merchant, ...userData } = userWithMerchant;

      return {
        user: userData,
        merchant: merchant,
        // ⭐ Retorna o apiSecret em TEXTO PLANO apenas UMA VEZ (no cadastro)
        apiSecret: apiSecret, // Usuário deve salvar isso!
        message: 'Registro e Lojista criados com sucesso! Salve suas credenciais de API em local seguro.',
      };
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('O e-mail fornecido já está em uso.');
      }
      throw error;
    }
  }

  async login(dto: LoginAuthDto) {
    // 1. Busca usuário
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        merchant: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // 2. Valida senha
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // 3. Gera JWT payload
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      merchantId: user.merchant?.id,
    };

    const { password, apiSecret, merchant, ...userData } = user;

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        ...userData,
        // ⚠️ NÃO retornar apiSecret hasheado no login
      },
      merchant: merchant,
    };
  }
}