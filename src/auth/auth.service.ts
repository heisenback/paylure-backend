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

function generateApiKey(): string {
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `paylure_${randomPart}`;
}

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
      return {
        user: userData,
        merchant: merchant,
        apiSecret: apiSecret,
        message: 'Registro criado com sucesso.',
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
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { merchant: true },
    });

    if (!user) throw new UnauthorizedException('E-mail ou senha inválidos.');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('E-mail ou senha inválidos.');

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      merchantId: user.merchant?.id,
    };

    const { password, apiSecret, merchant, ...userData } = user;

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: userData,
      merchant: merchant,
    };
  }

  async getUserWithBalance(userId: string) {
    this.logger.log(`🔍 Buscando usuário ${userId}`);
    
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
        // 🔥 CORREÇÃO CRÍTICA: Incluímos o merchant aqui!
        merchant: {
          select: {
            id: true,
            storeName: true,
            cnpj: true
          }
        }
      },
    });

    if (!user) throw new NotFoundException('Usuário não encontrado');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const depositsToday = await this.prisma.deposit.aggregate({
      where: {
        userId: userId,
        status: 'CONFIRMED',
        createdAt: { gte: startOfDay },
      },
      _sum: { netAmountInCents: true },
    });

    const totalDeposits = await this.prisma.deposit.count({
      where: { userId: userId, status: 'CONFIRMED' },
    });

    const totalWithdrawals = await this.prisma.withdrawal.count({
      where: { userId: userId, status: 'CONFIRMED' },
    });

    const depositsTodayInCents = depositsToday._sum.netAmountInCents || 0;

    return {
      user: user,
      balance: user.balance,
      stats: {
        depositsToday: depositsTodayInCents,
        totalTransactions: totalDeposits + totalWithdrawals,
      },
    };
  }
}