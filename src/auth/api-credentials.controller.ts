// ============================================
// 📁 src/auth/api-credentials.controller.ts
// ============================================
import {
  Controller,
  Post,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCredentialsService } from './api-credentials.service';
import { GetUser } from './decorators/get-user.decorator';
import type { User } from '@prisma/client';

@Controller('auth')
@UseGuards(AuthGuard('jwt'))
export class ApiCredentialsController {
  private readonly logger = new Logger(ApiCredentialsController.name);

  constructor(private readonly apiCredentialsService: ApiCredentialsService) {}

  /**
   * GET /api/auth/me
   * Retorna dados do usuário incluindo client_id
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@GetUser() user: User) {
    this.logger.log(`📋 Buscando dados do usuário: ${user.email}`);
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      client_id: user.apiKey,
      // Nunca retorna o client_secret por segurança
      client_secret: user.apiSecret ? 'configured' : null,
      balance: user.balance,
      createdAt: user.createdAt,
    };
  }

  /**
   * POST /api/auth/regenerate-credentials
   * Gera novas credenciais (INVALIDA as antigas)
   */
  @Post('regenerate-credentials')
  @HttpCode(HttpStatus.OK)
  async regenerateCredentials(@GetUser() user: User) {
    this.logger.log(`🔄 Regenerando credenciais para: ${user.email}`);
    
    const result = await this.apiCredentialsService.regenerateCredentials(
      user.id,
      false // Não envia email automaticamente
    );

    return {
      client_id: result.apiKey,
      client_secret: result.apiSecret, // ⚠️ Retorna plain text APENAS uma vez
      message: 'Credenciais geradas com sucesso! Salve o Secret em local seguro - você não poderá vê-lo novamente.',
    };
  }

  /**
   * POST /api/auth/send-credentials-email
   * Envia credenciais atuais por email
   */
  @Post('send-credentials-email')
  @HttpCode(HttpStatus.OK)
  async sendCredentialsEmail(@GetUser() user: User) {
    this.logger.log(`📧 Enviando credenciais por email para: ${user.email}`);
    
    // Verifica se o usuário tem credenciais
    if (!user.apiKey || !user.apiSecret) {
      return {
        success: false,
        message: 'Você ainda não possui credenciais. Gere novas credenciais primeiro.',
      };
    }

    // Envia email com as credenciais atuais
    // Nota: O secret não pode ser recuperado (está hasheado), então o email
    // dirá ao usuário para regenerar se precisar do secret completo
    await this.apiCredentialsService.sendCredentialsReminder(user.id);

    return {
      success: true,
      message: 'Email enviado com sucesso!',
    };
  }
}


// ============================================
// 📁 src/auth/api-credentials.service.ts
// ============================================
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
   * Envia lembrete de credenciais por email
   * (Secret não pode ser recuperado, está hasheado)
   */
  async sendCredentialsReminder(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    if (!user.apiKey) {
      throw new BadRequestException('Você ainda não possui credenciais configuradas.');
    }

    // Envia email com o client_id e aviso sobre o secret
    await this.mailService.sendAPICredentials(
      user.email,
      user.name,
      user.apiKey,
      '••••••••••••••••••••••••••••••••', // Secret mascarado
    );

    this.logger.log(`✅ Lembrete de credenciais enviado para: ${user.email}`);
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


// ============================================
// 📁 ATUALIZAÇÃO NO src/mail/mail.service.ts
// ============================================
// Adicione este método no seu mail.service.ts existente:

/**
 * Envia lembrete de credenciais (quando o secret está mascarado)
 */
async sendAPICredentialsReminder(
  to: string,
  name: string,
  apiKey: string,
): Promise<void> {
  try {
    await this.transporter.sendMail({
      from: `"Paylure" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: '🔑 Lembrete de Credenciais - Paylure',
      html: this.getAPICredentialsReminderTemplate(name, apiKey),
    });

    this.logger.log(`✅ Lembrete de credenciais enviado para: ${to}`);
  } catch (error) {
    this.logger.error(`❌ Erro ao enviar lembrete para ${to}:`, error);
    throw error;
  }
}

private getAPICredentialsReminderTemplate(name: string, apiKey: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: linear-gradient(135deg, #1e293b 0%, #4c1d95 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
        .header { background: linear-gradient(90deg, #9333ea 0%, #06b6d4 100%); padding: 40px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 32px; }
        .content { padding: 40px; color: #e9d5ff; }
        .credentials { background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(168, 85, 247, 0.2); padding: 20px; border-radius: 12px; margin: 20px 0; }
        .cred-item { margin: 16px 0; }
        .cred-label { color: rgba(216, 180, 254, 0.7); font-size: 14px; margin-bottom: 8px; }
        .cred-value { background: rgba(168, 85, 247, 0.1); padding: 12px; border-radius: 8px; font-family: monospace; word-break: break-all; color: #a855f7; }
        .footer { padding: 20px 40px; text-align: center; color: rgba(233, 213, 255, 0.5); font-size: 14px; border-top: 1px solid rgba(168, 85, 247, 0.2); }
        .info { background: rgba(59, 130, 246, 0.1); border-left: 4px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔑 Suas Credenciais</h1>
        </div>
        <div class="content">
          <p>Olá, <strong>${name}</strong>!</p>
          <p>Aqui está seu Client ID:</p>
          
          <div class="credentials">
            <div class="cred-item">
              <div class="cred-label">Client ID (API Key)</div>
              <div class="cred-value">${apiKey}</div>
            </div>
          </div>

          <div class="info">
            <p style="margin: 0;"><strong>ℹ️ Sobre o Client Secret:</strong></p>
            <p style="margin: 8px 0 0 0;">
              Por motivos de segurança, o Client Secret não pode ser recuperado. 
              Se você perdeu seu Secret, precisará regenerar novas credenciais no painel.
            </p>
          </div>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Paylure. Todos os direitos reservados.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}