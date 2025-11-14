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
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
        'Origin': 'https://api.the-key.club',
        'Referer': 'https://api.the-key.club/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
      validateStatus: () => true,
    });

    const preset = (process.env.KEY_CLUB_ACCESS_TOKEN || '').trim();
    if (preset) {
      this.token = preset;
      this.logger.log('[KeyclubService] Usando KEY_CLUB_ACCESS_TOKEN do .env (pula login).');
    }
  }

  private isCloudflareBlock(ax: AxiosError<any>) {
    const res = ax.response;
    if (!res) return false;
    const status = res.status;
    const headers = Object.fromEntries(
      Object.entries(res.headers || {}).map(([k, v]) => [String(k).toLowerCase(), String(v ?? '').toLowerCase()])
    );
    const cfServer = headers['server']?.includes('cloudflare');
    const hasRay = 'cf-ray' in headers;
    return status === 403 && (cfServer || hasRay);
  }

  private authHeaders() {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private async login(): Promise<string> {
    if (this.token) return this.token;

    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      this.logger.error('[KeyclubService] Falta KEY_CLUB_CLIENT_ID/SECRET no .env.');
      throw new Error('Credenciais da KeyClub ausentes.');
    }

    this.logger.log('[KeyclubService] Autenticando na KeyClub...');
    
    try {
      const resp = await this.http.post('/api/auth/login', {
        client_id: clientId,
        client_secret: clientSecret,
      });

      const token = resp.data?.accessToken || resp.data?.token;

      if (resp.status === 200 && token) {
        this.token = String(token);
        this.logger.log('[KeyclubService] Token obtido com sucesso!');
        return this.token;
      }

      if (resp.status === 403) {
        const server = String(resp.headers?.['server'] || '').toLowerCase();
        const hasCfRay = Boolean(resp.headers?.['cf-ray']);
        if (hasCfRay || server.includes('cloudflare')) {
          throw new Error(
            'Login barrado pelo Cloudflare. Use KEY_CLUB_ACCESS_TOKEN no .env ou solicite excecao WAF.'
          );
        }
        throw new Error('Credenciais invalidas (403). Revise KEY_CLUB_CLIENT_ID/SECRET.');
      }

      if (resp.status === 401) {
        throw new Error('Credenciais invalidas (401). Revise KEY_CLUB_CLIENT_ID/SECRET.');
      }

      this.logger.error(
        `[KeyclubService] Login falhou: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error('Erro ao autenticar na KeyClub.');
    } catch (error) {
      this.logger.error('[KeyclubService] Erro durante login:', error);
      throw error;
    }
  }

  private async ensureToken(force = false): Promise<string> {
    if (this.token && !force) return this.token;
    return this.login();
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const ax = e as AxiosError<any>;
      const status = ax.response?.status;

      if (ax.response && this.isCloudflareBlock(ax)) {
        throw new Error('Barrado pelo Cloudflare. Considere excecao WAF.');
      }

      if (status === 401 || status === 403) {
        const preset = Boolean((process.env.KEY_CLUB_ACCESS_TOKEN || '').trim());
        if (preset) {
          throw new Error('Token invalido/expirado. Atualize KEY_CLUB_ACCESS_TOKEN.');
        }
        this.logger.warn('[KeyclubService] Token expirado. Reautenticando...');
        await this.ensureToken(true);
        return await fn();
      }

      throw e;
    }
  }

  async createDeposit(input: CreateDepositInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new Error('Valor minimo para deposito e R$ 1,00.');
    }

    const externalId =
      input.externalId?.trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const clientCallbackUrl =
      input.clientCallbackUrl ||
      process.env.KEY_CLUB_CALLBACK_URL ||
      `${process.env.BASE_URL}/api/v1/webhooks/keyclub`;

    const document = input.payer?.document?.toString().replace(/\D/g, '');
    if (!document || document.length < 11) {
      throw new Error('Documento do pagador invalido.');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: externalId,
      clientCallbackUrl,
      payer: {
        name: input.payer.name,
        email: input.payer.email,
        document,
        ...(input.payer.phone ? { phone: input.payer.phone } : {}),
      },
    };

    this.logger.log(`[KeyclubService] Criando deposito: ${JSON.stringify(payload)}`);

    const exec = async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.authHeaders(),
      });

      this.logger.log(`[KeyclubService] Resposta da KeyClub: status=${resp.status}`);

      if (resp.status === 201 || resp.status === 200) {
        this.logger.log(`[KeyclubService] Deposito criado (${externalId}) no valor de R$ ${payload.amount}.`);
        return resp.data;
      }

      if (resp.status === 401) {
        this.logger.error('[KeyclubService] Token invalido (401)');
        throw new Error('Access token is missing or invalid.');
      }

      if (resp.status === 403) {
        const server = String(resp.headers?.['server'] || '').toLowerCase();
        const hasCfRay = Boolean(resp.headers?.['cf-ray']);
        
        this.logger.error(`[KeyclubService] Erro 403: Server=${server}, CF-Ray=${hasCfRay}`);
        
        if (hasCfRay || server.includes('cloudflare')) {
          throw new Error('Deposito barrado pelo Cloudflare WAF.');
        }
        
        throw new Error('Acesso negado pela KeyClub. Verifique as credenciais.');
      }

      if (resp.status >= 500) {
        this.logger.error(`[KeyclubService] Erro do servidor KeyClub: ${resp.status}`);
        throw new Error('Gateway temporariamente indisponivel. Tente novamente em instantes.');
      }

      this.logger.error(
        `[KeyclubService] Deposito falhou: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(resp.data?.message || 'Erro da API da KeyClub ao criar deposito.');
    };

    return this.withAuthRetry(exec);
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new Error('Valor minimo para saque e R$ 1,00.');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description,
      clientCallbackUrl: input.clientCallbackUrl,
    };

    const exec = async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.authHeaders(),
      });

      if (resp.status === 200 || resp.status === 201) {
        this.logger.log(`[KeyclubService] Saque criado (${payload.external_id}) no valor de R$ ${payload.amount}.`);
        return resp.data;
      }

      if (resp.status === 401 || resp.status === 403) {
        const server = String(resp.headers?.['server'] || '').toLowerCase();
        const hasCfRay = Boolean(resp.headers?.['cf-ray']);
        if (resp.status === 403 && (hasCfRay || server.includes('cloudflare'))) {
          throw new Error('Saque barrado pelo Cloudflare.');
        }
        throw new Error('Access token is missing or invalid.');
      }

      this.logger.error(
        `[KeyclubService] Saque falhou: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(resp.data?.message || 'Erro da API da KeyClub ao criar saque.');
    };

    return this.withAuthRetry(exec);
  }
}