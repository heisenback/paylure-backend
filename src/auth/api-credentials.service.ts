// src/auth/api-credentials.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import * as bcrypt from 'bcrypt';
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
export class ApiCredentialsService {
  private readonly logger = new Logger(ApiCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Gera novas credenciais de API
   * ⚠️ As credenciais antigas são INVALIDADAS
   */
  async regenerateCredentials(userId: string, sendEmail: boolean = true): Promise<{
    apiKey: string;
    apiSecret: string;
    message: string;
  }> {
    this.logger.log(`🔑 Gerando novas credenciais para userId: ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    // Gera novas credenciais
    const apiKey = generateApiKey();
    const apiSecret = generateApiSecret();

    // Hash do secret
    const salt = await bcrypt.genSalt(10);
    const hashedApiSecret = await bcrypt.hash(apiSecret, salt);

    // Atualiza no banco
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        apiKey,
        apiSecret: hashedApiSecret,
      },
    });

    // Envia por email se solicitado
    if (sendEmail) {
      await this.mailService.sendAPICredentials(
        user.email,
        user.name,
        apiKey,
        apiSecret,
      );
    }

    this.logger.log(`✅ Credenciais geradas para: ${user.email}`);

    return {
      apiKey,
      apiSecret, // ⚠️ Retorna plain text APENAS uma vez
      message: 'Credenciais geradas com sucesso! Salve o Secret em local seguro - você não poderá vê-lo novamente.',
    };
  }

  /**
   * Obtém apenas a API Key (sem o secret)
   */
  async getApiKey(userId: string): Promise<{ apiKey: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { apiKey: true },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return {
      apiKey: user.apiKey,
    };
  }

  /**
   * Valida credenciais de API
   */
  async validateCredentials(apiKey: string, apiSecret: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { apiKey },
    });

    if (!user) {
      return false;
    }

    // Compara secret
    const isValid = await bcrypt.compare(apiSecret, user.apiSecret);

    return isValid;
  }
}