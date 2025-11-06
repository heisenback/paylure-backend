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
      timeout: 30000, // 30 segundos
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      httpsAgent: new https.Agent({ 
        keepAlive: true, 
        maxSockets: 50,
        rejectUnauthorized: true, // Valida certificado SSL
      }),
    });
  }

  /** Detecta bloqueio do Cloudflare */
  private isCloudflareBlock(error: any): boolean {
    if (!error.response) return false;
    
    const status = error.response.status;
    const headers = error.response.headers || {};
    const data = error.response.data;
    
    // Checa se tem Ray ID ou server Cloudflare
    const hasCfRay = headers['cf-ray'] || headers['CF-RAY'];
    const isCfServer = String(headers['server'] || '').toLowerCase().includes('cloudflare');
    const hasBlockedContent = typeof data === 'string' && 
      (data.includes('Sorry, you have been blocked') || data.includes('Cloudflare'));
    
    return status === 403 && (hasCfRay || isCfServer || hasBlockedContent);
  }

  /** Headers com Authorization */
  private authHeaders() {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /** Faz login com retry e tratamento de erros */
  private async login(): Promise<string> {
    const clientId = process.env.KEY_CLUB_CLIENT_ID?.trim();
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      this.logger.error('[KeyclubService] ❌ Credenciais ausentes no .env');
      throw new Error('Credenciais da KeyClub não configuradas. Configure KEY_CLUB_CLIENT_ID e KEY_CLUB_CLIENT_SECRET.');
    }

    this.logger.log('[KeyclubService] 🔐 Tentando autenticar...');
    this.logger.log(`[KeyclubService] URL: ${this.baseUrl}/api/auth/login`);
    this.logger.log(`[KeyclubService] Client ID: ${clientId}`);

    try {
      const { data, status, headers } = await this.http.post(
        '/api/auth/login',
        { 
          client_id: clientId, 
          client_secret: clientSecret 
        },
        { 
          validateStatus: () => true, // Aceita qualquer status
          maxRedirects: 0, // Não segue redirects
        }
      );

      if (status === 200 && data?.token) {
        this.token = String(data.token);
        this.logger.log('[KeyclubService] ✅ Token obtido com sucesso!');
        return this.token!;
      }

      if (status === 403) {
        const cfRay = headers['cf-ray'] || headers['CF-RAY'];
        const hasCloudflare = this.isCloudflareBlock({ response: { status, headers, data } });
        
        if (hasCloudflare) {
          this.logger.error('[KeyclubService] 🛡️ BLOQUEADO PELO CLOUDFLARE!');
          this.logger.error(`[KeyclubService] Ray ID: ${cfRay}`);
          this.logger.error('[KeyclubService] IP do servidor: 62.171.175.190');
          throw new Error(
            'Bloqueado pelo Cloudflare - Entre em contato com o suporte da KeyClub para whitelist do IP 62.171.175.190'
          );
        }
      }

      this.logger.error(`[KeyclubService] ❌ Login falhou: status=${status}`);
      this.logger.error(`[KeyclubService] Response: ${JSON.stringify(data).slice(0, 200)}`);
      throw new Error('Erro da API da KeyClub na autenticação.');
      
    } catch (e) {
      const ax = e as AxiosError<any>;
      
      if (ax.response) {
        if (this.isCloudflareBlock(ax)) {
          this.logger.error('[KeyclubService] 🛡️ BLOQUEADO PELO CLOUDFLARE!');
          throw new Error(
            'Bloqueado pelo Cloudflare - Entre em contato com o suporte da KeyClub para whitelist do IP 62.171.175.190'
          );
        }
        this.logger.error(`[KeyclubService] ❌ Erro HTTP: status=${ax.response.status}`);
      } else {
        this.logger.error(`[KeyclubService] ❌ Erro de rede: ${(e as Error).message}`);
      }
      
      throw new Error('Erro da API da KeyClub');
    }
  }

  /** Garante token válido */
  private async ensureToken(force = false): Promise<string> {
    if (!force && this.token) return this.token!;
    return this.login();
  }

  /** Executa request com retry de autenticação */
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const ax = e as AxiosError<any>;
      const status = ax.response?.status;

      if (this.isCloudflareBlock(ax)) {
        throw e; // Não retry em bloqueio Cloudflare
      }

      // Se 401/403, tenta reautenticar uma vez
      if (status === 401 || status === 403) {
        this.logger.warn('[KeyclubService] 🔄 Token inválido, tentando reautenticar...');
        await this.ensureToken(true);
        return await fn();
      }
      
      throw e;
    }
  }

  /** DEPÓSITO */
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

    const doRequest = async () => {
      this.logger.log(`[KeyclubService] 📤 Criando depósito: ${externalId} - R$ ${amount.toFixed(2)}`);
      
      const { data, status, headers } = await this.http.post(
        '/api/payments/deposit',
        payload,
        { 
          headers: this.authHeaders(), 
          validateStatus: () => true 
        }
      );

      if (status === 201) {
        this.logger.log(`[KeyclubService] ✅ Depósito criado: ${externalId}`);
        return {
          transactionId: data.qrCodeResponse?.transactionId || externalId,
          pixCode: data.qrCodeResponse?.qrcode,
          status: data.qrCodeResponse?.status || 'PENDING',
          amount: data.qrCodeResponse?.amount || amount,
        };
      }

      if (status === 403 && this.isCloudflareBlock({ response: { status, headers, data } })) {
        throw new Error('Bloqueado pelo Cloudflare no endpoint de depósito. Contate o suporte da KeyClub.');
      }

      this.logger.error(`[KeyclubService] ❌ Depósito falhou: status=${status}`);
      throw new AxiosError('Depósito falhou', String(status), undefined, undefined, { status } as any);
    };

    return this.withAuthRetry(doRequest);
  }

  /** SAQUE */
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

    const doRequest = async () => {
      this.logger.log(`[KeyclubService] 📤 Criando saque: ${input.externalId} - R$ ${amount.toFixed(2)}`);
      
      const { data, status, headers } = await this.http.post(
        '/api/withdrawals/withdraw',
        payload,
        { 
          headers: this.authHeaders(), 
          validateStatus: () => true 
        }
      );

      if (status === 200 || status === 201) {
        this.logger.log(`[KeyclubService] ✅ Saque criado: ${input.externalId}`);
        return data;
      }

      if (status === 403 && this.isCloudflareBlock({ response: { status, headers, data } })) {
        throw new Error('Bloqueado pelo Cloudflare no endpoint de saque. Contate o suporte da KeyClub.');
      }

      this.logger.error(`[KeyclubService] ❌ Saque falhou: status=${status}`);
      throw new AxiosError('Saque falhou', String(status), undefined, undefined, { status } as any);
    };

    return this.withAuthRetry(doRequest);
  }
}