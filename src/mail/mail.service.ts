import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export type MailType = 'acesso' | 'entrega' | 'parceiros' | 'seguranca' | 'financeiro';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend | null = null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;

    // ✅ Nunca instanciar Resend se não tiver chave válida
    if (!apiKey || apiKey === 're_123' || apiKey.trim() === '') {
      this.logger.warn(
        '⚠️ RESEND_API_KEY não configurada ou inválida! O sistema continuará rodando, mas e-mails não serão enviados.',
      );
      this.resend = null;
      return;
    }

    try {
      this.resend = new Resend(apiKey);
      this.logger.log('📧 MailService (Resend) inicializado com sucesso.');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.logger.error(`❌ Erro ao inicializar Resend: ${msg}`);
      this.resend = null;
    }
  }

  private getFromEmail(type: MailType = 'seguranca'): string {
    // se quiser variar por tipo, dá pra mapear aqui
    return 'Paylure <nao-responder@paylure.com.br>';
  }

  private async sendMail(options: any) {
    if (!this.resend) {
      this.logger.warn(`📢 Simulação: E-mail para ${options.to} não enviado (Resend offline).`);
      return;
    }

    try {
      await this.resend.emails.send(options);
    } catch (error) {
      const msg = (error as any)?.message ?? String(error);
      this.logger.error(`❌ Falha ao enviar e-mail: ${msg}`);
    }
  }

  async sendCoproductionInvite(
    email: string,
    productName: string,
    percentage: number,
    producerName: string,
  ): Promise<void> {
    await this.sendMail({
      from: this.getFromEmail('parceiros'),
      to: [email],
      subject: `🤝 Convite de Co-produção: ${productName}`,
      html: `<p>Olá, ${producerName} te convidou para ser co-produtor do produto ${productName} com ${percentage}% de comissão.</p>`,
    });
  }

  async sendAccessEmail(to: string, productName: string, loginUrl: string): Promise<void> {
    await this.sendMail({
      from: this.getFromEmail('acesso'),
      to: [to],
      subject: `✅ Seu acesso ao ${productName} chegou!`,
      html: `<p>Olá, seu acesso está disponível em: <a href="${loginUrl}">${loginUrl}</a></p>`,
    });
  }

  async sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void> {
    await this.sendMail({
      from: this.getFromEmail('seguranca'),
      to: [to],
      subject: '🔑 Recuperação de Senha - Paylure',
      html: this.getPasswordResetTemplate(name, resetUrl),
    });
  }

  async sendPasswordChanged(to: string, name: string): Promise<void> {
    await this.sendMail({
      from: this.getFromEmail('seguranca'),
      to: [to],
      subject: '🔒 Sua senha foi alterada',
      html: this.getPasswordChangedTemplate(name),
    });
  }

  async send2FACode(to: string, name: string, code: string): Promise<void> {
    await this.sendMail({
      from: this.getFromEmail('seguranca'),
      to: [to],
      subject: '🔒 Seu Código de Verificação - Paylure',
      html: this.get2FACodeTemplate(name, code),
    });
  }

  async sendAPICredentials(to: string, name: string, apiKey: string, apiSecret: string): Promise<void> {
    const isReminder = apiSecret.includes('•');

    await this.sendMail({
      from: this.getFromEmail('seguranca'),
      to: [to],
      subject: isReminder ? '🔑 Suas Credenciais de API' : '🔑 Novas Credenciais de API',
      html: isReminder
        ? this.getAPICredentialsReminderTemplate(name, apiKey)
        : this.getAPICredentialsTemplate(name, apiKey, apiSecret),
    });
  }

  // --- TEMPLATES ---
  private getPasswordResetTemplate(name: string, resetUrl: string): string {
    return `<p>Olá ${name}, recupere sua senha aqui: <a href="${resetUrl}">Link</a></p>`;
  }

  private getPasswordChangedTemplate(name: string): string {
    return `<p>Olá ${name}, sua senha foi alterada com segurança.</p>`;
  }

  private get2FACodeTemplate(name: string, code: string): string {
    return `<p>Olá ${name}, seu código de verificação é: <strong>${code}</strong></p>`;
  }

  private getAPICredentialsTemplate(name: string, apiKey: string, apiSecret: string): string {
    return `<p>Olá ${name}, suas credenciais: <br>API Key: ${apiKey}<br>API Secret: ${apiSecret}</p>`;
  }

  private getAPICredentialsReminderTemplate(name: string, apiKey: string): string {
    return `<p>Olá ${name}, lembrete de sua API Key: ${apiKey}</p>`;
  }
}
