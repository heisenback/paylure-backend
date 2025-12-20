// src/mail/mail.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export type MailType = 'acesso' | 'entrega' | 'parceiros' | 'seguranca' | 'financeiro';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend;

  constructor() {
    // Verifica se a chave existe
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        this.logger.warn("⚠️ RESEND_API_KEY não encontrada no .env! E-mails não serão enviados.");
    }
    this.resend = new Resend(apiKey);
  }

  // ✅ CORREÇÃO: Usar um remetente único e seguro para garantir a entrega inicial
  // Depois que validar, você pode criar os subdomínios no Resend
  private getFromEmail(type: MailType = 'seguranca'): string {
    // DICA: Use 'nao-responder' ou 'contato' do domínio principal para evitar bloqueios de DNS
    return 'Paylure <nao-responder@paylure.com.br>'; 
  }

  // ======================================================
  // 🤝 E-MAILS DE CO-PRODUÇÃO
  // ======================================================
  async sendCoproductionInvite(email: string, productName: string, percentage: number, producerName: string) {
    const registerLink = `${process.env.FRONTEND_URL}/register?email=${email}`;

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #020617; color: #cbd5e1;">
        <div style="background-color: #0f172a; padding: 40px; border-radius: 16px; border: 1px solid #1e293b; text-align: center;">
          <h2 style="color: #ffffff; margin-top: 0;">🤝 Convite de Co-produção</h2>
          <p style="font-size: 16px; color: #94a3b8;">
            Olá! <strong>${producerName}</strong> convidou você para ser co-produtor do produto:
          </p>
          <h3 style="color: #a855f7; font-size: 20px;">${productName}</h3>
          <p>Sua comissão: <strong style="color: #10b981;">${percentage}%</strong></p>
          <div style="margin: 30px 0;">
            <a href="${registerLink}" style="background: linear-gradient(90deg, #9333ea 0%, #2563eb 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;"> Aceitar e Criar Conta </a>
          </div>
          <p style="font-size: 12px; color: #475569;">Se você já tem conta, a co-produção será ativada automaticamente na próxima venda.</p>
        </div>
      </div>
    `;

    try {
      this.logger.log(`📧 Tentando enviar convite para: ${email} (Produto: ${productName})`);
      
      const data = await this.resend.emails.send({
        from: this.getFromEmail('parceiros'),
        to: [email],
        subject: `Convite de Co-produção: ${productName}`,
        html: html,
      });

      if (data.error) {
          this.logger.error(`❌ Erro Resend: ${data.error.message}`);
      } else {
          this.logger.log(`✅ Convite enviado com sucesso! ID: ${data.data?.id}`);
      }
    } catch (error) {
      this.logger.error(`❌ EXCEÇÃO ao enviar convite:`, error);
    }
  }

  // ======================================================
  // 📦 E-MAILS DE PRODUTO
  // ======================================================
  async sendAccessEmail(email: string, productName: string, accessLink: string, password?: string) {
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
        from: this.getFromEmail('entrega'),
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
  // 🔐 E-MAILS DE SISTEMA
  // ======================================================
  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.getFromEmail('seguranca'),
        to: [to],
        subject: '🔐 Recuperação de Senha - Paylure',
        html: this.getPasswordResetTemplate(name, resetUrl),
      });
      this.logger.log(`✅ Email de reset enviado para: ${to}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar reset:`, error);
    }
  }

  async sendPasswordChangedEmail(to: string, name: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.getFromEmail('seguranca'),
        to: [to],
        subject: '✅ Senha Alterada com Sucesso - Paylure',
        html: this.getPasswordChangedTemplate(name),
      });
    } catch (error) { this.logger.error(error); }
  }

  async send2FACode(to: string, name: string, code: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.getFromEmail('seguranca'),
        to: [to],
        subject: '🔒 Seu Código de Verificação - Paylure',
        html: this.get2FACodeTemplate(name, code),
      });
    } catch (error) { this.logger.error(error); }
  }

  async sendAPICredentials(to: string, name: string, apiKey: string, apiSecret: string): Promise<void> {
    try {
      const isReminder = apiSecret.includes('•');
      await this.resend.emails.send({
        from: this.getFromEmail('seguranca'),
        to: [to],
        subject: isReminder ? '🔑 Suas Credenciais de API' : '🔑 Novas Credenciais de API',
        html: isReminder ? this.getAPICredentialsReminderTemplate(name, apiKey) : this.getAPICredentialsTemplate(name, apiKey, apiSecret),
      });
    } catch (error) { this.logger.error(error); }
  }

  // --- TEMPLATES ---
  private getPasswordResetTemplate(name: string, resetUrl: string): string {
    return `<p>Olá ${name}, recupere sua senha aqui: <a href="${resetUrl}">Link</a></p>`;
  }
  private getPasswordChangedTemplate(name: string): string {
    return `<p>Olá ${name}, sua senha foi alterada.</p>`;
  }
  private get2FACodeTemplate(name: string, code: string): string {
    return `<p>Seu código é: <strong>${code}</strong></p>`;
  }
  private getAPICredentialsTemplate(name: string, key: string, secret: string): string {
    return `<p>Key: ${key}<br>Secret: ${secret}</p>`;
  }
  private getAPICredentialsReminderTemplate(name: string, key: string): string {
    return `<p>Key: ${key}</p>`;
  }
}