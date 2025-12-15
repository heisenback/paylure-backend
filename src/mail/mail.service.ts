// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend;

  constructor() {
    // Inicializa o Resend com sua chave API
    // (Idealmente mantenha no .env, mas deixei o fallback aqui para funcionar direto pra você)
    this.resend = new Resend(process.env.RESEND_API_KEY || 're_fwiSDVRK_CsvXUcWeX6ddCuG6aMPHqf37');
  }

  /**
   * Define quem está enviando o e-mail.
   * Se você já verificou o domínio 'paylure.com.br' no Resend, ele usa o oficial.
   * Se não, usa o 'onboarding' para testes.
   */
  private getFromEmail(): string {
    // DICA: Mude para true quando tiver configurado o DNS do paylure.com.br no Resend
    const isDomainVerified = false; 
    
    return isDomainVerified 
      ? 'Paylure <noreply@paylure.com.br>' 
      : 'Paylure <onboarding@resend.dev>';
  }

  // ======================================================
  // 📦 E-MAILS DE PRODUTO (NOVO - Para entregar o curso)
  // ======================================================

  async sendAccessEmail(email: string, productName: string, accessLink: string, password?: string) {
    const subject = `Seu acesso chegou! - ${productName}`;
    
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h2 style="color: #7c3aed; text-align: center;">Parabéns pela compra!</h2>
        
        <p style="font-size: 16px; line-height: 1.6;">
          Olá! O seu acesso ao conteúdo <strong>${productName}</strong> já está liberado.
        </p>

        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;">
          <p style="margin: 0 0 10px 0;"><strong>Seus dados de acesso:</strong></p>
          <p style="margin: 0;">📧 Login: <strong>${email}</strong></p>
          ${password ? `<p style="margin: 5px 0 0 0;">🔑 Senha Provisória: <strong>${password}</strong></p>` : ''}
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${accessLink}" style="background-color: #7c3aed; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Acessar Área de Membros
          </a>
        </div>

        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #666; font-size: 12px; text-align: center;">Equipe Paylure</p>
      </div>
    `;

    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [email],
        subject: subject,
        html: html,
      });
      this.logger.log(`✅ E-mail de acesso enviado para: ${email}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar acesso para ${email}:`, error);
    }
  }

  // ======================================================
  // 🔐 E-MAILS DE SISTEMA (AUTH/API)
  // ======================================================

  /**
   * Envia email de recuperação de senha
   */
  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: '🔐 Recuperação de Senha - Paylure',
        html: this.getPasswordResetTemplate(name, resetUrl),
      });
      this.logger.log(`✅ Email de reset enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar reset para ${to}:`, error);
      throw error;
    }
  }

  /**
   * Envia email confirmando mudança de senha
   */
  async sendPasswordChangedEmail(to: string, name: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: '✅ Senha Alterada com Sucesso - Paylure',
        html: this.getPasswordChangedTemplate(name),
      });
      this.logger.log(`✅ Email de confirmação enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar confirmação para ${to}:`, error);
    }
  }

  /**
   * Envia código de 2FA por email
   */
  async send2FACode(to: string, name: string, code: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: '🔒 Seu Código de Verificação - Paylure',
        html: this.get2FACodeTemplate(name, code),
      });
      this.logger.log(`✅ Código 2FA enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar 2FA para ${to}:`, error);
      throw error;
    }
  }

  /**
   * Envia credenciais API por email
   */
  async sendAPICredentials(to: string, name: string, apiKey: string, apiSecret: string): Promise<void> {
    try {
      const isReminder = apiSecret.includes('•');
      await this.resend.emails.send({
        from: this.getFromEmail(),
        to: [to],
        subject: isReminder ? '🔑 Suas Credenciais de API - Paylure' : '🔑 Novas Credenciais de API - Paylure',
        html: isReminder ? 
          this.getAPICredentialsReminderTemplate(name, apiKey) : 
          this.getAPICredentialsTemplate(name, apiKey, apiSecret),
      });
      this.logger.log(`✅ Credenciais enviadas para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar credenciais para ${to}:`, error);
      throw error;
    }
  }

  // ===================================
  // TEMPLATES HTML (Mantidos do Original)
  // ===================================

  private getPasswordResetTemplate(name: string, resetUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="font-family: sans-serif; background: #0f172a; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; overflow: hidden; color: #e9d5ff;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #06b6d4 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">🔐 Recuperação</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Recebemos uma solicitação para redefinir sua senha.</p>
            <center>
              <a href="${resetUrl}" style="display: inline-block; background: #10b981; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0;">Redefinir Senha</a>
            </center>
            <p style="font-size: 12px; color: #94a3b8;">Link expira em 1 hora.</p>
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
      <body style="font-family: sans-serif; background: #0f172a; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; overflow: hidden; color: #e9d5ff;">
          <div style="background: linear-gradient(90deg, #10b981 0%, #14b8a6 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">✅ Senha Alterada</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Sua senha foi alterada com sucesso. Se não foi você, contate o suporte.</p>
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
      <body style="font-family: sans-serif; background: #0f172a; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; overflow: hidden; color: #e9d5ff;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #06b6d4 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">🔒 Verificação</h1>
          </div>
          <div style="padding: 40px; text-align: center;">
            <p>Olá, <strong>${name}</strong>!</p>
            <div style="background: rgba(168, 85, 247, 0.1); border: 2px solid #a855f7; padding: 20px; border-radius: 12px; margin: 20px 0;">
              <span style="font-size: 40px; font-weight: bold; color: #a855f7; letter-spacing: 5px;">${code}</span>
            </div>
            <p style="font-size: 12px; color: #94a3b8;">Válido por 5 minutos.</p>
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
      <body style="font-family: sans-serif; background: #0f172a; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; overflow: hidden; color: #e9d5ff;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #06b6d4 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">🔑 API Credentials</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <div style="background: #0f172a; padding: 20px; border-radius: 8px; font-family: monospace;">
              <p style="margin: 5px 0; color: #94a3b8;">Client ID:</p>
              <p style="margin: 0 0 15px 0; color: #a855f7;">${apiKey}</p>
              <p style="margin: 5px 0; color: #94a3b8;">Client Secret:</p>
              <p style="margin: 0; color: #a855f7;">${apiSecret}</p>
            </div>
            <p style="color: #ef4444; font-size: 12px; margin-top: 20px;">⚠️ Guarde o Secret em local seguro. Ele não será exibido novamente.</p>
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
      <body style="font-family: sans-serif; background: #0f172a; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; overflow: hidden; color: #e9d5ff;">
          <div style="background: linear-gradient(90deg, #9333ea 0%, #06b6d4 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">🔑 API Reminder</h1>
          </div>
          <div style="padding: 40px;">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Seu Client ID é:</p>
            <div style="background: #0f172a; padding: 20px; border-radius: 8px; font-family: monospace; color: #a855f7;">
              ${apiKey}
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}