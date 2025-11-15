// src/auth/password-reset.service.ts
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MailService } from 'src/mail/mail.service'; // Você precisará criar este serviço

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Solicita reset de senha - envia email com token
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    this.logger.log(`🔐 Solicitação de reset de senha para: ${email}`);

    // Busca usuário
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // ⚠️ SEGURANÇA: Não revela se o email existe ou não
    if (!user) {
      this.logger.warn(`⚠️ Email não encontrado: ${email}`);
      return {
        message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.',
      };
    }

    // Gera token único
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Expira em 1 hora

    // Salva token no banco
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Envia email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    await this.mailService.sendPasswordResetEmail(user.email, user.name, resetUrl);

    this.logger.log(`✅ Email de reset enviado para: ${email}`);

    return {
      message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.',
    };
  }

  /**
   * Valida token de reset
   */
  async validateResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    const resetRequest = await this.prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRequest) {
      return { valid: false };
    }

    if (resetRequest.used) {
      return { valid: false };
    }

    if (new Date() > resetRequest.expiresAt) {
      return { valid: false };
    }

    return {
      valid: true,
      email: resetRequest.user.email,
    };
  }

  /**
   * Reseta a senha
   */
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    this.logger.log(`🔐 Tentativa de reset de senha com token`);

    // Busca token
    const resetRequest = await this.prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRequest) {
      throw new BadRequestException('Token inválido ou expirado.');
    }

    if (resetRequest.used) {
      throw new BadRequestException('Este link já foi utilizado.');
    }

    if (new Date() > resetRequest.expiresAt) {
      throw new BadRequestException('Este link expirou. Solicite um novo.');
    }

    // Valida senha
    if (newPassword.length < 8) {
      throw new BadRequestException('A senha deve ter no mínimo 8 caracteres.');
    }

    // Hash da nova senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Atualiza senha e marca token como usado
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRequest.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordReset.update({
        where: { id: resetRequest.id },
        data: { used: true },
      }),
    ]);

    this.logger.log(`✅ Senha resetada com sucesso para: ${resetRequest.user.email}`);

    // Envia email de confirmação
    await this.mailService.sendPasswordChangedEmail(
      resetRequest.user.email,
      resetRequest.user.name,
    );

    return {
      message: 'Senha alterada com sucesso! Você já pode fazer login.',
    };
  }
}