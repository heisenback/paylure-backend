// src/auth/auth.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
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
 * Gera um API Secret forte
 */
function generateApiSecret(): string {
  const randomPart = crypto.randomBytes(32).toString('hex');
  return `sk_live_${randomPart}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    this.logger.log('🔧 AuthService inicializado');
  }

  async register(dto: RegisterAuthDto) {
    this.logger.log(`📄 Iniciando registro para: ${dto.email}`);
    
    // 1. Verifica se o email já existe
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      this.logger.warn(`⚠️  Email já cadastrado: ${dto.email}`);
      throw new ConflictException('Este e-mail já está em uso.');
    }

    // 2. Gera CNPJ único e nome padrão da loja
    const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14);
    const defaultStoreName = `Loja-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 3. Gera credenciais de API
    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();

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
          document: dto.document || null,
          password: hashedPassword,
          apiKey: apiKey,
          apiSecret: hashedApiSecret,
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
          document: true,
          createdAt: true,
          updatedAt: true,
          balance: true, // 🎯 INCLUI BALANCE
          merchant: true,
          apiKey: true,
        },
      });

      const { merchant, ...userData } = userWithMerchant;

      this.logger.log(`✅ Usuário criado com sucesso: ${dto.email}`);

      return {
        user: userData,
        merchant: merchant,
        apiSecret: apiSecret,
        message: 'Registro e Lojista criados com sucesso! Salve suas credenciais de API em local seguro.',
      };
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('O e-mail fornecido já está em uso.');
      }
      this.logger.error(`❌ Erro ao criar usuário: ${error.message}`);
      throw error;
    }
  }

  async login(dto: LoginAuthDto) {
    this.logger.log(`📄 Tentativa de login: ${dto.email}`);
    
    // 1. Busca usuário
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        merchant: true,
      },
    });

    if (!user) {
      this.logger.warn(`⚠️  Usuário não encontrado: ${dto.email}`);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // 2. Valida senha
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      this.logger.warn(`⚠️  Senha inválida para: ${dto.email}`);
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

    this.logger.log(`✅ Login bem-sucedido: ${dto.email}`);

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: userData,
      merchant: merchant,
    };
  }

  // 🎯 NOVO MÉTODO: Busca usuário com balance atualizado
  async getUserWithBalance(userId: string) {
    this.logger.log(`🔍 Buscando usuário ${userId} com balance atualizado`);
    
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        document: true,
        balance: true, // 🎯 IMPORTANTE: Busca o balance do banco
        role: true,
        createdAt: true,
        updatedAt: true,
        apiKey: true,
      },
    });

    if (!user) {
      this.logger.error(`❌ Usuário ${userId} não encontrado`);
      throw new NotFoundException('Usuário não encontrado');
    }

    this.logger.log(`✅ Balance do usuário ${user.email}: ${user.balance} centavos`);
    
    return user;
  }
}