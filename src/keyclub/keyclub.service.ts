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
    document: string; // CPF/CNPJ apenas números
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
  private token: string | null = null; // cache
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        // headers "de navegador" - ajudam a passar em WAFs conservadores
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
      },
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
      validateStatus: () => true,
    });

    // Se houver token pré-configurado, usa e NÃO tenta fazer /api/auth/login
    const preset = (process.env.KEY_CLUB_ACCESS_TOKEN || '').trim();
    if (preset) {
      this.token = preset;
      this.logger.log('[KeyclubService] Usando KEY_CLUB_ACCESS_TOKEN do .env (pula /api/auth/login).');
    }
  }

  /** Detecta bloqueio Cloudflare (WAF) */
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

  /** Autentica só se não houver KEY_CLUB_ACCESS_TOKEN */
  private async login(): Promise<string> {
    if (this.token) return this.token;

    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      this.logger.error('[KeyclubService] ❌ Falta KEY_CLUB_CLIENT_ID/SECRET no .env.');
      throw new Error('Credenciais da KeyClub ausentes.');
    }

    this.logger.log('[KeyclubService] 🔐 Autenticando na KeyClub...');
    const resp = await this.http.post('/api/auth/login', {
      client_id: clientId,
      client_secret: clientSecret,
    });

    if (resp.status === 200 && resp.data?.accessToken) {
      this.token = String(resp.data.accessToken);
      this.logger.log('[KeyclubService] ✅ Token obtido com sucesso.');
      return this.token!;
    }

    if (resp.status === 403) {
      const server = String(resp.headers?.['server'] || '').toLowerCase();
      const hasCfRay = Boolean(resp.headers?.['cf-ray']);
      if (hasCfRay || server.includes('cloudflare')) {
        throw new Error(
          'Login barrado pelo Cloudflare da KeyClub (/api/auth/login). Use KEY_CLUB_ACCESS_TOKEN no .env ou solicite exceção WAF.'
        );
      }
      throw new Error('Credenciais inválidas da KeyClub (403). Revise KEY_CLUB_CLIENT_ID/SECRET.');
    }

    if (resp.status === 401) {
      throw new Error('Credenciais inválidas da KeyClub (401). Revise KEY_CLUB_CLIENT_ID/SECRET.');
    }

    this.logger.error(
      `[KeyclubService] ❌ Login falhou: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 400)}`
    );
    throw new Error('Erro ao autenticar na KeyClub.');
  }

  private async ensureToken(force = false): Promise<string> {
    // se veio de KEY_CLUB_ACCESS_TOKEN, ignore force
    if (this.token && !force) return this.token!;
    return this.login();
  }

  /** Retry 1x quando 401/403 por token inválido (exceto se veio do .env). */
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const ax = e as AxiosError<any>;
      const status = ax.response?.status;

      if (ax.response && this.isCloudflareBlock(ax)) {
        throw new Error('Chamada barrada pelo Cloudflare na KeyClub. Considere exceção WAF.');
      }

      if (status === 401 || status === 403) {
        const preset = Boolean((process.env.KEY_CLUB_ACCESS_TOKEN || '').trim());
        if (preset) {
          // Token fixo inválido/expirado
          throw new Error('Token da KeyClub inválido/expirado. Atualize KEY_CLUB_ACCESS_TOKEN no .env.');
        }
        this.logger.warn('[KeyclubService] 🔄 Token possivelmente expirado. Reautenticando...');
        await this.ensureToken(true);
        return await fn();
      }

      throw e;
    }
  }

  /** DEPÓSITO — POST /api/payments/deposit (201) */
  async createDeposit(input: CreateDepositInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new Error('Valor mínimo para depósito é R$ 1,00.');
    }

    const externalId =
      input.externalId?.trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const clientCallbackUrl =
      input.clientCallbackUrl ||
      process.env.KEY_CLUB_CALLBACK_URL ||
      `${process.env.BASE_URL}/api/v1/keyclub/callback`;

    const document = input.payer?.document?.toString().replace(/\D/g, '');
    if (!document || document.length < 11) {
      throw new Error('Documento do pagador inválido.');
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

    const exec = async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.authHeaders(),
      });

      if (resp.status === 201) {
        this.logger.log(`[KeyclubService] ✅ Depósito criado (${externalId}) no valor de R$ ${payload.amount}.`);
        return resp.data;
      }

      if (resp.status === 401 || resp.status === 403) {
        const server = String(resp.headers?.['server'] || '').toLowerCase();
        const hasCfRay = Boolean(resp.headers?.['cf-ray']);
        if (resp.status === 403 && (hasCfRay || server.includes('cloudflare'))) {
          throw new Error('Depósito barrado pelo Cloudflare da KeyClub. Exceção WAF para /api/payments/deposit.');
        }
        // Sem WAF → provavelmente token inválido
        throw new Error('Access token is missing or invalid.');
      }

      this.logger.error(
        `[KeyclubService] ❌ Depósito falhou: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(resp.data?.message || 'Erro da API da KeyClub ao criar depósito.');
    };

    return this.withAuthRetry(exec);
  }

  /** SAQUE — POST /api/withdrawals/withdraw */
  async createWithdrawal(input: CreateWithdrawalInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new Error('Valor mínimo para saque é R$ 1,00.');
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
        this.logger.log(`[KeyclubService] ✅ Saque criado (${payload.external_id}) no valor de R$ ${payload.amount}.`);
        return resp.data;
      }

      if (resp.status === 401 || resp.status === 403) {
        const server = String(resp.headers?.['server'] || '').toLowerCase();
        const hasCfRay = Boolean(resp.headers?.['cf-ray']);
        if (resp.status === 403 && (hasCfRay || server.includes('cloudflare'))) {
          throw new Error('Saque barrado pelo Cloudflare da KeyClub. Exceção WAF para /api/withdrawals/withdraw.');
        }
        throw new Error('Access token is missing or invalid.');
      }

      this.logger.error(
        `[KeyclubService] ❌ Saque falhou: status=${resp.status} body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(resp.data?.message || 'Erro da API da KeyClub ao criar saque.');
    };

    return this.withAuthRetry(exec);
  }
}
