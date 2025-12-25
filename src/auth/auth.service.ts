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

  private isValidCPF(cpf: string): boolean {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
    let add = 0;
    for (let i = 0; i < 9; i++) add += parseInt(cpf.charAt(i)) * (10 - i);
    let rev = 11 - (add % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cpf.charAt(9))) return false;
    add = 0;
    for (let i = 0; i < 10; i++) add += parseInt(cpf.charAt(i)) * (11 - i);
    rev = 11 - (add % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cpf.charAt(10))) return false;
    return true;
  }

  async register(dto: RegisterAuthDto) {
    const emailLower = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: emailLower } });
    if (existing) throw new ConflictException('E-mail já cadastrado.');

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const user = await this.prisma.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        name: dto.name,
        role: 'USER',
        apiKey: generateApiKey(),
        apiSecret: generateApiSecret(),
      },
    });

    try {
      const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14);
      await this.prisma.merchant.create({
        data: {
          userId: user.id,
          storeName: `Loja de ${dto.name.split(' ')[0]}`,
          cnpj: uniqueCnpj,
        },
      });
    } catch (e) {
      this.logger.error(`Falha ao criar merchant automático: ${e.message}`);
    }

    return this.generateToken(user);
  }

  async login(dto: LoginAuthDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      include: { merchant: true },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    return this.generateToken(user);
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1h

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpires: expires },
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    // CORREÇÃO AQUI: sendPasswordResetEmail -> sendPasswordReset
    await this.mailService.sendPasswordReset(user.email, user.name, resetUrl);

    return { message: 'E-mail de recuperação enviado.' };
  }

  async resetPassword(token: string, newPass: string) {
    const user = await this.prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpires: { gt: new Date() } },
    });

    if (!user) throw new BadRequestException('Token inválido ou expirado.');

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(newPass, salt);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpires: null },
    });

    // CORREÇÃO AQUI: sendPasswordChangedEmail -> sendPasswordChanged
    await this.mailService.sendPasswordChanged(user.email, user.name);

    return { success: true };
  }

  private async generateToken(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        balance: user.balance,
        merchant: user.merchant,
      },
    };
  }

  async changePassword(userId: string, newPass: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário inexistente.');

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(newPass, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // CORREÇÃO AQUI: sendPasswordChangedEmail -> sendPasswordChanged
    await this.mailService.sendPasswordChanged(user.email, user.name);

    return { success: true, message: 'Senha alterada com sucesso!' };
  }
}