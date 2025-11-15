// src/auth/two-factor.service.ts
import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // ===================================
  // 📧 ATIVAR 2FA POR EMAIL
  // ===================================
  async enableEmailTwoFactor(userId: string): Promise<{ message: string }> {
    this.logger.log(`🔐 Ativando 2FA por email para userId: ${userId}`);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: 'EMAIL',
        twoFactorSecret: null, // Remove secret do Google Auth se existir
      },
    });

    return {
      message: 'Autenticação de dois fatores por email ativada com sucesso!',
    };
  }

  // ===================================
  // 📱 GERAR QR CODE PARA GOOGLE AUTHENTICATOR
  // ===================================
  async generateGoogleAuthSecret(userId: string): Promise<{ qrCode: string; secret: string }> {
    this.logger.log(`🔐 Gerando secret do Google Auth para userId: ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    // Gera secret
    const secret = speakeasy.generateSecret({
      name: `Paylure (${user.email})`,
      issuer: 'Paylure',
      length: 32,
    });

    // Salva secret no banco (ainda não ativa o 2FA)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret.base32,
      },
    });

    // Gera QR Code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

    return {
      qrCode,
      secret: secret.base32,
    };
  }

  // ===================================
  // ✅ ATIVAR 2FA COM GOOGLE AUTHENTICATOR
  // ===================================
  async enableGoogleAuthTwoFactor(userId: string, verificationCode: string): Promise<{ message: string }> {
    this.logger.log(`🔐 Ativando 2FA Google Auth para userId: ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('Secret do Google Authenticator não encontrado. Gere um QR Code primeiro.');
    }

    // Verifica o código fornecido
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: verificationCode,
      window: 2, // Aceita códigos com +/- 60 segundos de diferença
    });

    if (!verified) {
      throw new BadRequestException('Código de verificação inválido. Tente novamente.');
    }

    // Ativa 2FA
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorMethod: 'GOOGLE_AUTH',
      },
    });

    return {
      message: 'Autenticação de dois fatores com Google Authenticator ativada com sucesso!',
    };
  }

  // ===================================
  // ❌ DESATIVAR 2FA
  // ===================================
  async disableTwoFactor(userId: string): Promise<{ message: string }> {
    this.logger.log(`🔐 Desativando 2FA para userId: ${userId}`);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorMethod: null,
        twoFactorSecret: null,
      },
    });

    // Remove códigos antigos
    await this.prisma.twoFactorCode.deleteMany({
      where: { userId },
    });

    return {
      message: 'Autenticação de dois fatores desativada com sucesso.',
    };
  }

  // ===================================
  // 📧 ENVIAR CÓDIGO 2FA POR EMAIL
  // ===================================
  async sendEmailTwoFactorCode(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    // Gera código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // Expira em 5 minutos

    // Salva código no banco
    await this.prisma.twoFactorCode.create({
      data: {
        userId,
        code,
        expiresAt,
      },
    });

    // Envia email
    await this.mailService.send2FACode(user.email, user.name, code);

    this.logger.log(`✅ Código 2FA enviado para: ${user.email}`);

    return {
      message: 'Código de verificação enviado para seu email.',
    };
  }

  // ===================================
  // ✅ VERIFICAR CÓDIGO 2FA
  // ===================================
  async verifyTwoFactorCode(userId: string, code: string, method: 'EMAIL' | 'GOOGLE_AUTH'): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    if (method === 'EMAIL') {
      // Busca código no banco
      const storedCode = await this.prisma.twoFactorCode.findFirst({
        where: {
          userId,
          code,
          used: false,
          expiresAt: { gt: new Date() },
        },
      });

      if (!storedCode) {
        throw new UnauthorizedException('Código inválido ou expirado.');
      }

      // Marca código como usado
      await this.prisma.twoFactorCode.update({
        where: { id: storedCode.id },
        data: { used: true },
      });

      return true;
    }

    if (method === 'GOOGLE_AUTH') {
      if (!user.twoFactorSecret) {
        throw new UnauthorizedException('Google Authenticator não configurado.');
      }

      // Verifica código do Google Authenticator
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });

      if (!verified) {
        throw new UnauthorizedException('Código inválido.');
      }

      return true;
    }

    throw new BadRequestException('Método de 2FA inválido.');
  }

  // ===================================
  // 📊 OBTER STATUS DO 2FA
  // ===================================
  async getTwoFactorStatus(userId: string): Promise<{
    enabled: boolean;
    method: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorEnabled: true,
        twoFactorMethod: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return {
      enabled: user.twoFactorEnabled,
      method: user.twoFactorMethod,
    };
  }
}