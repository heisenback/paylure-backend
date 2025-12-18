// src/auth/auth.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import * as uuid from 'uuid';
import * as crypto from 'crypto';
import { MailService } from 'src/mail/mail.service'; 

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
    private readonly mailService: MailService, 
  ) {
    this.logger.log('🔧 AuthService inicializado');
  }

  // ✅ HELPER: Validação Matemática de CPF
  private isValidCPF(cpf: string): boolean {
    const strCPF = cpf.replace(/[^\d]+/g, '');
    if (strCPF === '' || strCPF.length !== 11 || /^(\d)\1{10}$/.test(strCPF)) return false;

    let soma = 0;
    let resto;
    for (let i = 1; i <= 9; i++) soma += parseInt(strCPF.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(strCPF.substring(9, 10))) return false;

    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(strCPF.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(strCPF.substring(10, 11))) return false;
    
    return true;
  }

  async register(dto: RegisterAuthDto) {
    this.logger.log(`📄 Iniciando registro para: ${dto.email}`);

    if (!dto.document) {
        throw new BadRequestException('O CPF é obrigatório.');
    }
    const cpfLimpo = dto.document.replace(/\D/g, '');
    if (!this.isValidCPF(cpfLimpo)) {
        throw new BadRequestException('CPF inválido. Verifique os números digitados.');
    }
    
    const emailExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (emailExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    const docFormatted = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    const cpfExists = await this.prisma.user.findFirst({
      where: {
        OR: [
          { document: cpfLimpo },
          { document: docFormatted }
        ]
      },
    });
    
    if (cpfExists) {
      throw new ConflictException('Este CPF já está cadastrado em outra conta.');
    }

    // ===============================================
    // 1. CÁLCULO DA TAXA DE LANÇAMENTO (AUTOMÁTICO)
    // ===============================================
    const now = new Date();
    // Data limite da PROMOÇÃO 1: 26/12/2025 às 23:59
    const launchEndDate = new Date('2025-12-26T23:59:59'); 
    
    let finalFeePercent = 8.0; // Padrão
    let finalFeeFixed = 200;   // Padrão (R$ 2,00)
    let isFounderUser = false; // Flag de Membro Fundador

    if (now <= launchEndDate) {
        // FASE 1: SEMANA DE LANÇAMENTO (19 a 26/12)
        // Taxa: 4% + R$ 1,00
        finalFeePercent = 4.0;
        finalFeeFixed = 100;
        isFounderUser = true; // Ganha selo de Fundador
        this.logger.log(`🔥 Usuário entrou na PROMOÇÃO DE LANÇAMENTO (4% + R$1) - FOUNDER`);
    } else {
        // FASE 2: PÓS-LANÇAMENTO
        // Verifica o total de usuários cadastrados até agora
        const currentUsersCount = await this.prisma.user.count();

        // Se tem MENOS de 100 usuários (contando todo mundo que já entrou)
        if (currentUsersCount < 100) {
            // FASE 2: Os 100 primeiros (tardios)
            // Taxa: 5% + R$ 1,50
            finalFeePercent = 5.0;
            finalFeeFixed = 150;
            isFounderUser = true; // Ganha selo de Fundador
            this.logger.log(`🚀 Usuário entrou no lote dos 100 PRIMEIROS (5% + R$1,50) - FOUNDER`);
        } else {
            // FASE 3: PADRÃO
            // Taxa: 8% + R$ 2,00
            finalFeePercent = 8.0;
            finalFeeFixed = 200;
            isFounderUser = false;
            this.logger.log(`👤 Usuário entrou na taxa PADRÃO (8% + R$2)`);
        }
    }

    // ===============================================
    // 2. LÓGICA DE INDICAÇÃO (REFERRAL)
    // ===============================================
    let referralData = {};
    const inputCode = (dto as any).referralCode; // Pega o código da URL

    if (inputCode) {
       const referrer = await this.prisma.user.findUnique({ where: { referralCode: inputCode } });
       if (referrer) {
          // Calcula data de expiração da comissão (Hoje + 3 Meses)
          const endsAt = new Date();
          endsAt.setMonth(endsAt.getMonth() + 3);
          
          referralData = {
             referredById: referrer.id,
             referralEndsAt: endsAt,
             referralCommissionRate: 0.01 // 1% de comissão
          };
          this.logger.log(`🔗 Usuário indicado por: ${referrer.email}`);
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
      const userWithMerchant: any = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name || 'Usuário Padrão',
          document: cpfLimpo,
          phone: dto.whatsapp ? dto.whatsapp.replace(/\D/g, '') : null, 
          password: hashedPassword,
          apiKey: apiKey,
          apiSecret: hashedApiSecret,
          
          // ✅ INJETA AS TAXAS CALCULADAS E A FLAG DE FUNDADOR
          transactionFeePercent: finalFeePercent,
          transactionFeeFixed: finalFeeFixed,
          isFounder: isFounderUser,

          // ✅ INJETA OS DADOS DE INDICAÇÃO
          ...referralData,

          merchant: {
            create: {
              storeName: defaultStoreName,
              cnpj: uniqueCnpj,
            },
          },
        } as any, 
        include: { merchant: true },
      });

      const { password, apiSecret: secret, ...userData } = userWithMerchant;
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
    let user: any = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { merchant: true },
    });

    if (!user) throw new UnauthorizedException('E-mail ou senha inválidos.');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('E-mail ou senha inválidos.');

    if (!user.merchant) {
       user = await this.fixMissingMerchant(user.id, user.name);
    }

    if (!user) {
      throw new UnauthorizedException('Erro ao carregar dados do usuário.');
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

  async getUserWithBalance(userId: string) {
    let user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { merchant: true },
    });

    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (!user.merchant) {
      const fixedUser: any = await this.fixMissingMerchant(userId, user.name);
      if (fixedUser && fixedUser.merchant) {
        user = { ...user, merchant: fixedUser.merchant };
      }
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const depositsToday = await this.prisma.deposit.aggregate({
      where: { userId: userId, status: 'CONFIRMED', createdAt: { gte: startOfDay } },
      _sum: { netAmountInCents: true },
    });

    const totalTrans = await this.prisma.deposit.count({ where: { userId: userId, status: 'CONFIRMED' } }) + 
                       await this.prisma.withdrawal.count({ where: { userId: userId, status: 'CONFIRMED' } });

    const { password, apiSecret, ...safeUser } = user;

    return {
      user: safeUser,
      balance: user.balance,
      stats: {
        depositsToday: depositsToday._sum.netAmountInCents || 0,
        totalTransactions: totalTrans,
      },
    };
  }

  // ✅ NOVO MÉTODO: RECUPERAÇÃO DE SENHA PROFISSIONAL
  async forgotPassword(email: string) {
    this.logger.log(`🔒 Solicitação de reset para: ${email}`);
    
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Se o usuário EXISTIR, geramos o token e enviamos o e-mail.
    if (user) {
      // Cria um token JWT válido por 1 hora apenas para o reset
      const payload = { sub: user.id, email: user.email, type: 'password_reset' };
      const token = await this.jwtService.signAsync(payload, { expiresIn: '1h' });

      // Link para o frontend
      const resetUrl = `${process.env.FRONTEND_URL || 'https://paylure.com.br'}/reset-password?token=${token}`;

      // Dispara o e-mail de segurança
      await this.mailService.sendPasswordResetEmail(user.email, user.name, resetUrl);
    } 
    // SE NÃO EXISTIR: Não fazemos nada, apenas logamos (opcional) e retornamos sucesso abaixo.

    // 🛡️ SEGURANÇA: Retorno neutro para evitar enumeração de usuários.
    // O hacker não saberá se o e-mail existe ou não.
    return {
      message: 'Se este e-mail estiver cadastrado em nossa base, você receberá um link de recuperação em instantes.'
    };
  }

  async changePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const isMatch = await bcrypt.compare(currentPass, user.password);
    if (!isMatch) {
      throw new BadRequestException('A senha atual está incorreta.');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPass, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Envia e-mail confirmando a alteração (Segurança)
    await this.mailService.sendPasswordChangedEmail(user.email, user.name);

    this.logger.log(`🔐 Senha alterada com sucesso para o usuário ${user.email}`);
    return { success: true, message: 'Senha alterada com sucesso!' };
  }

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
          
          const updatedUser = await this.prisma.user.findUnique({
              where: { id: userId },
              include: { merchant: true }
          });
          
          if (!updatedUser) {
              throw new Error('Falha ao recuperar usuário após criar merchant');
          }
          
          return updatedUser;
      } catch (err) {
          this.logger.error(`❌ Falha crítica no auto-fix do merchant: ${err}`);
          throw err;
      }
  }
}