// src/keyclub/keyclub.service.ts
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';

type CreateDepositInput = {
  amount: number;
  externalId?: string;
  clientCallbackUrl?: string;
  payer: {
    name: string;
    email: string;
    document: string;
    phone?: string;
  };
};

export type CreateWithdrawalInput = {
  amount: number;
  externalId: string;
  pix_key: string;
  key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  description?: string;
  clientCallbackUrl?: string;
};

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  private readonly baseUrl =
    (process.env.KEY_CLUB_BASE_URL || 'https://api.the-key.club').replace(/\/+$/, '');
  private token: string | null = null;
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PaymentGateway/1.0',
      },
      httpsAgent: new https.Agent({ 
        keepAlive: true, 
        maxSockets: 50,
        rejectUnauthorized: true
      }),
      // 🔥 CORREÇÃO: Removido validateStatus: () => true para que o Axios
      // lance erros 401/403 e o withAuthRetry consiga capturá-los corretamente.
    });

    const preset = (process.env.KEY_CLUB_ACCESS_TOKEN || '').trim();
    if (preset) {
      this.token = preset;
      this.logger.log('✅ [KeyclubService] Iniciando com token do .env');
    }
  }

  private isCloudflareBlock(error: any): boolean {
    const res = error.response;
    if (!res) return false;
    
    const status = res.status;
    if (status !== 403 && status !== 503) return false;
    
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
    
    const isHtml = contentType.includes('text/html');
    
    const hasWafSignature = 
      body.includes('Attention Required') ||
      body.includes('cf-error-details') ||
      body.includes('cf-wrapper') ||
      body.includes('cloudflare-static/email-decode') ||
      body.includes('security check to access') ||
      body.includes('Why have I been blocked');
    
    if (isHtml && hasWafSignature) {
      this.logger.error('🚫 BLOQUEIO WAF REAL DETECTADO:', { status });
      return true;
    }
    
    return false;
  }

  private authHeaders() {
    if (!this.token) {
      throw new Error('Token não disponível. Tentativa de requisição sem login.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private async login(): Promise<string> {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      this.logger.error('❌ [KeyclubService] Credenciais (Client ID/Secret) ausentes no .env');
      throw new Error('Credenciais da KeyClub ausentes.');
    }

    this.logger.log('🔍 [KeyclubService] Autenticando...');
    
    try {
      // Usamos uma instância limpa do axios para login para evitar loops de interceptors se houvesse
      const resp = await axios.post(`${this.baseUrl}/api/auth/login`, {
        client_id: clientId,
        client_secret: clientSecret,
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: true })
      });

      const token = resp.data?.token || resp.data?.accessToken || resp.data?.access_token;
        
      if (!token) {
        this.logger.error('❌ [KeyclubService] Token não veio na resposta de login:', resp.data);
        throw new Error('API da KeyClub não retornou token válido.');
      }

      this.token = String(token).trim();
      this.logger.log('✅ [KeyclubService] Login realizado com sucesso!');
      return this.token;
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (this.isCloudflareBlock(error)) {
           throw new Error('Login bloqueado pelo WAF Cloudflare.');
        }
        if (error.response?.status === 401 || error.response?.status === 403) {
           throw new Error('Credenciais Client ID/Secret inválidas.');
        }
      }
      this.logger.error('❌ [KeyclubService] Falha no login:', error);
      throw error;
    }
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return await this.login();
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;

      // Se for bloqueio WAF real, não adianta tentar de novo
      if (this.isCloudflareBlock(error)) {
        throw new Error('Requisição bloqueada pelo WAF.');
      }

      // Se for erro de autenticação (401 ou 403 Invalid Token)
      if (status === 401 || status === 403) {
        this.logger.warn(`⚠️ [KeyclubService] Token rejeitado (Status ${status}). Tentando renovar...`);
        
        // Forçamos null para obrigar o login
        this.token = null;
        
        try {
          // Tenta fazer login novamente
          await this.login();
          // Tenta executar a função original novamente
          return await fn();
        } catch (loginError) {
          this.logger.error('❌ [KeyclubService] Falha ao renovar token após erro 403:', loginError);
          throw new Error('Falha de autenticação persistente na KeyClub.');
        }
      }

      // Se for outro erro, apenas repassa
      throw error;
    }
  }

  async createDeposit(input: CreateDepositInput) {
    // Garante token antes de começar
    if (!this.token) await this.ensureToken();

    const amount = Number(input.amount);
    if (amount < 1) throw new Error('Valor mínimo R$ 1,00');

    const externalId = input.externalId?.trim() || `DEP-${Date.now()}`;
    const document = input.payer?.document?.toString().replace(/\D/g, '');
    const email = input.payer.email?.trim();

    if (!document || (document.length !== 11 && document.length !== 14)) {
      throw new Error('CPF/CNPJ inválido');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: externalId,
      clientCallbackUrl: input.clientCallbackUrl,
      payer: {
        name: input.payer.name?.trim() || 'Cliente',
        email: email,
        document: document,
        ...(input.payer.phone ? { phone: input.payer.phone.replace(/\D/g, '') } : {}),
      },
    };

    return this.withAuthRetry(async () => {
      try {
        const resp = await this.http.post('/api/payments/deposit', payload, {
          headers: this.authHeaders(),
        });
        return resp.data;
      } catch (error: any) {
        // Tratamento de erros específicos de negócio (400)
        if (error.response?.status === 400) {
           const msg = error.response.data?.message || error.response.data?.error || 'Dados inválidos';
           throw new Error(`Erro KeyClub (400): ${msg}`);
        }
        throw error; // Deixa o withAuthRetry pegar 401/403
      }
    });
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    if (!this.token) await this.ensureToken();

    const amount = Number(input.amount);
    if (amount < 1) throw new Error('Valor mínimo R$ 1,00');

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description || `Saque ${input.externalId}`,
      clientCallbackUrl: input.clientCallbackUrl,
    };

    return this.withAuthRetry(async () => {
      try {
        const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
          headers: this.authHeaders(),
        });
        return resp.data;
      } catch (error: any) {
         if (error.response?.status === 400) {
           const msg = error.response.data?.message || 'Dados inválidos';
           throw new Error(`Erro KeyClub (400): ${msg}`);
        }
        throw error;
      }
    });
  }
}