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
    
    // 1. Verifica E-mail duplicado
    const emailExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (emailExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    // 2. Verifica CPF duplicado (Blindado)
    if (dto.document) {
      const docClean = dto.document.replace(/\D/g, '');
      // Formata para comparar caso o banco tenha salvo com pontos
      const docFormatted = docClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

      const cpfExists = await this.prisma.user.findFirst({
        where: {
          OR: [
            { document: docClean },
            { document: docFormatted }
          ]
        },
      });
      
      if (cpfExists) {
        throw new ConflictException('Este CPF já está cadastrado em outra conta.');
      }
    }

    const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14);
    const defaultStoreName = `Loja-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);
    const hashedApiSecret = await bcrypt.hash(apiSecret, salt);

    try {
      // Cria usuário JÁ com o merchant
      const userWithMerchant = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name || 'Usuário Padrão',
          document: dto.document ? dto.document.replace(/\D/g, '') : null,
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
        include: { merchant: true }, // Garante que retorna o merchant criado
      });

      const { password, apiSecret, ...userData } = userWithMerchant;
      return {
        user: userData,
        merchant: userWithMerchant.merchant,
        message: 'Conta criada com sucesso!',
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao criar usuário: ${error.message}`);
      throw error;
    }
  }

  async login(dto: LoginAuthDto) {
    let user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { merchant: true },
    });

    if (!user) throw new UnauthorizedException('E-mail ou senha inválidos.');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('E-mail ou senha inválidos.');

    // 🔥 AUTO-FIX NO LOGIN: Se não tiver merchant, cria agora.
    if (!user.merchant) {
       user = await this.fixMissingMerchant(user.id, user.name);
    }

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

  // ============================================================
  // 🚀 A SOLUÇÃO DEFINITIVA PARA O ERRO "PRODUTOR NÃO CONFIGURADO"
  // ============================================================
  async getUserWithBalance(userId: string) {
    // Busca o usuário tentando trazer o Merchant
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, document: true, balance: true,
        role: true, createdAt: true, updatedAt: true, apiKey: true,
        merchant: { select: { id: true, storeName: true, cnpj: true } }
      },
    });

    if (!user) throw new NotFoundException('Usuário não encontrado');

    // 🔥 AUTO-FIX NO DASHBOARD: Se chegou aqui e não tem merchant, CRIA NA HORA.
    // Isso impede que o frontend quebre ao tentar acessar user.merchant.id
    if (!user.merchant) {
      this.logger.warn(`⚠️ Usuário ${userId} acessou Dashboard sem Merchant. Corrigindo...`);
      const fixedUser = await this.fixMissingMerchant(userId, user.name);
      // Atualiza a variável local user com o novo merchant
      user = {
          ...user,
          merchant: {
              id: fixedUser.merchant.id,
              storeName: fixedUser.merchant.storeName,
              cnpj: fixedUser.merchant.cnpj
          }
      };
    }

    // Busca estatísticas (código mantido)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const depositsToday = await this.prisma.deposit.aggregate({
      where: { userId: userId, status: 'CONFIRMED', createdAt: { gte: startOfDay } },
      _sum: { netAmountInCents: true },
    });

    const totalTrans = await this.prisma.deposit.count({ where: { userId: userId, status: 'CONFIRMED' } }) + 
                       await this.prisma.withdrawal.count({ where: { userId: userId, status: 'CONFIRMED' } });

    return {
      user: user, // Agora garantimos que user.merchant existe
      balance: user.balance,
      stats: {
        depositsToday: depositsToday._sum.netAmountInCents || 0,
        totalTransactions: totalTrans,
      },
    };
  }

  // Função auxiliar para criar o merchant se faltar
  private async fixMissingMerchant(userId: string, userName: string) {
      try {
          const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14);
          const defaultStoreName = `Loja-${userName.split(' ')[0]}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          
          await this.prisma.merchant.create({
              data: {
                  userId: userId,
                  storeName: defaultStoreName,
                  cnpj: uniqueCnpj
              }
          });
          
          // Retorna o usuário atualizado
          return await this.prisma.user.findUnique({
              where: { id: userId },
              include: { merchant: true }
          });
      } catch (err) {
          this.logger.error(`❌ Falha crítica no auto-fix do merchant: ${err}`);
          throw err;
      }
  }
}