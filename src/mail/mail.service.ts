// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        '⚠️ RESEND_API_KEY não definido no ENV. Emails NÃO serão enviados.',
      );
    }
    this.resend = new Resend(apiKey || ''); // não hardcode
  }

  private getFromEmail(): string {
    // Você controla isso no ENV:
    // RESEND_FROM="Paylure <noreply@paylure.com.br>"
    // RESEND_DOMAIN_VERIFIED="true"
    const verified = String(process.env.RESEND_DOMAIN_VERIFIED || '').toLowerCase() === 'true';

    const fromVerified = process.env.RESEND_FROM?.trim();
    const fromFallback = process.env.RESEND_FROM_FALLBACK?.trim() || 'Paylure <onboarding@resend.dev>';

    if (verified && fromVerified) return fromVerified;
    return fromFallback;
  }

  // ======================================================
  // 📦 E-MAILS DE PRODUTO
  // ======================================================
  async sendAccessEmail(
    email: string,
    productName: string,
    accessLink: string,
    password?: string,
  ) {
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(`⚠️ Email ignorado (sem RESEND_API_KEY) para: ${email}`);
      return;
    }

    const subject = `Seu acesso chegou! - ${productName}`;

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #020617; color: #cbd5e1;">
        <div style="background-color: #0f172a; padding: 40px; border-radius: 16px; border: 1px solid #1e293b;">
          <h2 style="color: #ffffff; text-align: center; margin-top: 0;">Parabéns pela compra! 🚀</h2>

          <p style="font-size: 16px; line-height: 1.6; color: #94a3b8;">
            Olá! O pagamento foi confirmado e seu acesso ao <strong>${productName}</strong> foi liberado.
          </p>

          <div style="background-color: #1e293b; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #9333ea;">
            <p style="margin: 0 0 10px 0; color: #cbd5e1; font-size: 12px; text-transform: uppercase;">Suas Credenciais</p>
            <p style="margin: 0; color: #ffffff;">📧 Login: <strong>${email}</strong></p>
            ${password ? `<p style="margin: 10px 0 0 0; color: #a855f7;">🔑 Senha Provisória: <strong>${password}</strong></p>` : ''}
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${accessLink}" style="background: linear-gradient(90deg, #9333ea 0%, #2563eb 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
              Acessar Área de Membros
            </a>
          </div>

          <hr style="border: 0; border-top: 1px solid #1e293b; margin: 30px 0;" />
          <p style="color: #64748b; font-size: 12px; text-align: center;">Equipe Paylure</p>
        </div>
      </div>
    `;

    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [email],
        subject,
        html,
      });

      this.logger.log(`✅ E-mail de acesso enviado para: ${email}`);
    } catch (error: any) {
      this.logger.error(`❌ Erro ao enviar acesso para ${email}: ${error?.message || error}`);
    }
  }

  // ======================================================
  // 🔐 E-MAILS DE SISTEMA
  // ======================================================
  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(`⚠️ Email reset ignorado (sem RESEND_API_KEY) para: ${to}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: '🔐 Recuperação de Senha - Paylure',
        html: this.getPasswordResetTemplate(name, resetUrl),
      });
      this.logger.log(`✅ Email de reset enviado para: ${to}`);
    } catch (error: any) {
      this.logger.error(`❌ Erro ao enviar reset para ${to}: ${error?.message || error}`);
      throw error;
    }
  }

  async sendPasswordChangedEmail(to: string, name: string): Promise<void> {
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(`⚠️ Email changed ignorado (sem RESEND_API_KEY) para: ${to}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: '✅ Senha Alterada com Sucesso - Paylure',
        html: this.getPasswordChangedTemplate(name),
      });
      this.logger.log(`✅ Email de confirmação enviado para: ${to}`);
    } catch (error: any) {
      this.logger.error(`❌ Erro ao enviar confirmação para ${to}: ${error?.message || error}`);
    }
  }

  async send2FACode(to: string, name: string, code: string): Promise<void> {
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(`⚠️ Email 2FA ignorado (sem RESEND_API_KEY) para: ${to}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: '🔒 Seu Código de Verificação - Paylure',
        html: this.get2FACodeTemplate(name, code),
      });
      this.logger.log(`✅ Código 2FA enviado para: ${to}`);
    } catch (error: any) {
      this.logger.error(`❌ Erro ao enviar 2FA para ${to}: ${error?.message || error}`);
      throw error;
    }
  }

  async sendAPICredentials(to: string, name: string, apiKey: string, apiSecret: string): Promise<void> {
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(`⚠️ Email API creds ignorado (sem RESEND_API_KEY) para: ${to}`);
      return;
    }

    try {
      const isReminder = apiSecret.includes('•');
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: isReminder ? '🔑 Suas Credenciais de API - Paylure' : '🔑 Novas Credenciais de API - Paylure',
        html: isReminder
          ? this.getAPICredentialsReminderTemplate(name, apiKey)
          : this.getAPICredentialsTemplate(name, apiKey, apiSecret),
      });
      this.logger.log(`✅ Credenciais enviadas para: ${to}`);
    } catch (error: any) {
      this.logger.error(`❌ Erro ao enviar credenciais para ${to}: ${error?.message || error}`);
      throw error;
    }
  }

  // ===================================
  // TEMPLATES HTML
  // ===================================
  private getPasswordResetTemplate(name: string, resetUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #020617; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; color: #e2e8f0; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #2563eb 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🔐 Recuperação de Acesso</h1>
          </div>
          <div style="padding: 40px;">
            <p style="font-size: 16px;">Olá, <strong>${name}</strong>!</p>
            <p style="color: #94a3b8;">Recebemos uma solicitação para redefinir sua senha na Paylure.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: #10b981; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);">Redefinir Senha</a>
            </div>
            <p style="font-size: 13px; color: #64748b;">Se você não solicitou, ignore este email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getPasswordChangedTemplate(name: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #020617; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; color: #e2e8f0; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(90deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">✅ Senha Alterada</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <p style="color: #94a3b8;">Sua senha foi alterada com sucesso.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private get2FACodeTemplate(name: string, code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #020617; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; color: #e2e8f0; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #2563eb 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🔒 Verificação</h1>
          </div>
          <div style="padding: 40px; text-align: center;">
            <p>Olá, <strong>${name}</strong>!</p>
            <div style="background: rgba(147, 51, 234, 0.1); border: 2px solid #9333ea; padding: 20px; border-radius: 12px; margin: 20px 0;">
              <span style="font-size: 40px; font-weight: bold; color: #a855f7; letter-spacing: 5px;">${code}</span>
            </div>
            <p style="font-size: 12px; color: #64748b;">Válido por 5 minutos.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getAPICredentialsTemplate(name: string, apiKey: string, apiSecret: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #020617; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; color: #e2e8f0; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #2563eb 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🔑 API Credentials</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <div style="background: #020617; padding: 20px; border-radius: 8px; font-family: monospace; border: 1px solid #1e293b;">
              <p style="margin: 5px 0; color: #94a3b8;">Client ID:</p>
              <p style="margin: 0 0 15px 0; color: #a855f7;">${apiKey}</p>
              <p style="margin: 5px 0; color: #94a3b8;">Client Secret:</p>
              <p style="margin: 0; color: #a855f7;">${apiSecret}</p>
            </div>
            <p style="color: #ef4444; font-size: 12px; margin-top: 20px;">⚠️ Guarde o Secret. Ele não será exibido novamente.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getAPICredentialsReminderTemplate(name: string, apiKey: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #020617; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; color: #e2e8f0; border: 1px solid #1e293b;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #2563eb 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🔑 API Reminder</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Seu Client ID é:</p>
            <div style="background: #020617; padding: 20px; border-radius: 8px; font-family: monospace; color: #a855f7; border: 1px solid #1e293b;">
              ${apiKey}
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
