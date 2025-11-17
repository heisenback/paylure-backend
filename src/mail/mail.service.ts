// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    // Configuração do transportador de email
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  /**
   * Envia email de recuperação de senha
   */
  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"Paylure" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject: '🔐 Recuperação de Senha - Paylure',
        html: this.getPasswordResetTemplate(name, resetUrl),
      });

      this.logger.log(`✅ Email de reset enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar email para ${to}:`, error);
      throw error;
    }
  }

  /**
   * Envia email confirmando mudança de senha
   */
  async sendPasswordChangedEmail(to: string, name: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"Paylure" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject: '✅ Senha Alterada com Sucesso - Paylure',
        html: this.getPasswordChangedTemplate(name),
      });

      this.logger.log(`✅ Email de confirmação enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar email para ${to}:`, error);
    }
  }

  /**
   * Envia código de 2FA por email
   */
  async send2FACode(to: string, name: string, code: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"Paylure" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject: '🔒 Seu Código de Verificação - Paylure',
        html: this.get2FACodeTemplate(name, code),
      });

      this.logger.log(`✅ Código 2FA enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar código 2FA para ${to}:`, error);
      throw error;
    }
  }

  /**
   * Envia credenciais API por email
   */
  async sendAPICredentials(
    to: string,
    name: string,
    apiKey: string,
    apiSecret: string,
  ): Promise<void> {
    try {
      // Se o secret está mascarado, é um lembrete
      const isReminder = apiSecret.includes('•');
      
      await this.transporter.sendMail({
        from: `"Paylure" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject: isReminder ? '🔑 Suas Credenciais de API - Paylure' : '🔑 Novas Credenciais de API - Paylure',
        html: isReminder ? 
          this.getAPICredentialsReminderTemplate(name, apiKey) : 
          this.getAPICredentialsTemplate(name, apiKey, apiSecret),
      });

      this.logger.log(`✅ ${isReminder ? 'Lembrete' : 'Credenciais'} enviado(as) para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar credenciais para ${to}:`, error);
      throw error;
    }
  }

  // ===================================
  // TEMPLATES DE EMAIL
  // ===================================

  private getPasswordResetTemplate(name: string, resetUrl: string): string {
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
          .button { display: inline-block; background: linear-gradient(90deg, #10b981 0%, #14b8a6 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; margin: 20px 0; }
          .footer { padding: 20px 40px; text-align: center; color: rgba(233, 213, 255, 0.5); font-size: 14px; border-top: 1px solid rgba(168, 85, 247, 0.2); }
          .warning { background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 16px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Recuperação de Senha</h1>
          </div>
          <div class="content">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Recebemos uma solicitação para redefinir a senha da sua conta Paylure.</p>
            <p>Clique no botão abaixo para criar uma nova senha:</p>
            <center>
              <a href="${resetUrl}" class="button">Redefinir Senha</a>
            </center>
            <div class="warning">
              <p style="margin: 0;"><strong>⚠️ Atenção:</strong></p>
              <p style="margin: 8px 0 0 0;">Este link expira em 1 hora e só pode ser usado uma vez.</p>
            </div>
            <p>Se você não solicitou esta alteração, ignore este email. Sua senha permanecerá segura.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Paylure. Todos os direitos reservados.</p>
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
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background: linear-gradient(135deg, #1e293b 0%, #4c1d95 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
          .header { background: linear-gradient(90deg, #10b981 0%, #14b8a6 100%); padding: 40px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 32px; }
          .content { padding: 40px; color: #e9d5ff; }
          .footer { padding: 20px 40px; text-align: center; color: rgba(233, 213, 255, 0.5); font-size: 14px; border-top: 1px solid rgba(168, 85, 247, 0.2); }
          .success { background: rgba(16, 185, 129, 0.1); border-left: 4px solid #10b981; padding: 16px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Senha Alterada</h1>
          </div>
          <div class="content">
            <p>Olá, <strong>${name}</strong>!</p>
            <div class="success">
              <p style="margin: 0;">Sua senha foi alterada com sucesso!</p>
            </div>
            <p>Se você não realizou esta alteração, entre em contato com nosso suporte imediatamente.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Paylure. Todos os direitos reservados.</p>
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
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background: linear-gradient(135deg, #1e293b 0%, #4c1d95 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
          .header { background: linear-gradient(90deg, #9333ea 0%, #06b6d4 100%); padding: 40px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 32px; }
          .content { padding: 40px; color: #e9d5ff; }
          .code-box { background: rgba(168, 85, 247, 0.1); border: 2px solid #a855f7; padding: 24px; border-radius: 12px; text-align: center; margin: 20px 0; }
          .code { font-size: 48px; font-weight: bold; color: #a855f7; letter-spacing: 8px; }
          .footer { padding: 20px 40px; text-align: center; color: rgba(233, 213, 255, 0.5); font-size: 14px; border-top: 1px solid rgba(168, 85, 247, 0.2); }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔒 Código de Verificação</h1>
          </div>
          <div class="content">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Use o código abaixo para completar seu login:</p>
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            <p style="text-align: center; color: rgba(233, 213, 255, 0.7);">Este código expira em 5 minutos</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Paylure. Todos os direitos reservados.</p>
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
          .warning { background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 16px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔑 Novas Credenciais de API</h1>
          </div>
          <div class="content">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Suas novas credenciais de API foram geradas com sucesso:</p>
            
            <div class="credentials">
              <div class="cred-item">
                <div class="cred-label">Client ID (API Key)</div>
                <div class="cred-value">${apiKey}</div>
              </div>
              <div class="cred-item">
                <div class="cred-label">Client Secret (API Secret)</div>
                <div class="cred-value">${apiSecret}</div>
              </div>
            </div>

            <div class="warning">
              <p style="margin: 0;"><strong>⚠️ IMPORTANTE:</strong></p>
              <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                <li>Guarde estas credenciais em local seguro</li>
                <li>Nunca compartilhe seu Secret com terceiros</li>
                <li>Este é o único momento que você verá o Secret completo</li>
                <li>As credenciais antigas foram invalidadas</li>
              </ul>
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
          .warning { background: rgba(251, 191, 36, 0.1); border-left: 4px solid #fbbf24; padding: 16px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔑 Suas Credenciais de API</h1>
          </div>
          <div class="content">
            <p>Olá, <strong>${name}</strong>!</p>
            <p>Aqui está seu Client ID (API Key):</p>
            
            <div class="credentials">
              <div class="cred-item">
                <div class="cred-label">Client ID (API Key)</div>
                <div class="cred-value">${apiKey}</div>
              </div>
            </div>

            <div class="warning">
              <p style="margin: 0;"><strong>⚠️ SOBRE O CLIENT SECRET:</strong></p>
              <p style="margin: 8px 0 0 0;">Por segurança, seu Client Secret está criptografado e não pode ser recuperado. Se você perdeu o Secret, será necessário regenerar novas credenciais no painel.</p>
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
}