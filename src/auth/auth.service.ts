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
    
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      this.logger.warn(`⚠️ Email já cadastrado: ${dto.email}`);
      throw new ConflictException('Este e-mail já está em uso.');
    }

    const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14);
    const defaultStoreName = `Loja-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);
    const hashedApiSecret = await bcrypt.hash(apiSecret, salt);

    try {
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
          balance: true,
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
    
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        merchant: true,
      },
    });

    if (!user) {
      this.logger.warn(`⚠️ Usuário não encontrado: ${dto.email}`);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      this.logger.warn(`⚠️ Senha inválida para: ${dto.email}`);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

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

  // ===================================
  // 🚀 CORRIGIDO: Busca stats REAIS do banco
  // ===================================
  async getUserWithBalance(userId: string) {
    this.logger.log(`🔍 Buscando usuário ${userId} com estatísticas reais`);
    
    // 1. Busca o usuário
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        document: true,
        balance: true,
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

    // 🚀 2. Calcula o início do dia (00:00:00) no horário de Brasília (UTC-3)
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    );

    // 🚀 3. Busca depósitos confirmados HOJE
    const depositsToday = await this.prisma.deposit.aggregate({
      where: {
        userId: userId,
        status: 'CONFIRMED', // Apenas confirmados
        createdAt: {
          gte: startOfDay, // Desde o início do dia
        },
      },
      _sum: {
        netAmountInCents: true, // Soma dos valores líquidos
      },
    });

    // 🚀 4. Conta o TOTAL de transações confirmadas (Depósitos + Saques)
    const totalDeposits = await this.prisma.deposit.count({
      where: {
        userId: userId,
        status: 'CONFIRMED',
      },
    });

    const totalWithdrawals = await this.prisma.withdrawal.count({
      where: {
        userId: userId,
        status: 'CONFIRMED',
      },
    });

    const totalTransactions = totalDeposits + totalWithdrawals;

    // 🚀 5. Valores em centavos (seguro contra null)
    const depositsTodayInCents = depositsToday._sum.netAmountInCents || 0;

    this.logger.log(`✅ Stats calculados: DepositosHoje=${depositsTodayInCents} centavos | TotalTransações=${totalTransactions}`);
    
    // 6. Retorna no formato que o frontend espera
    return {
      user: user,
      balance: user.balance,
      stats: {
        depositsToday: depositsTodayInCents, // Em centavos!
        totalTransactions: totalTransactions,
      },
    };
  }
}