// src/keyclub/keyclub.service.ts
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
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
  private readonly baseUrl = (process.env.KEY_CLUB_BASE_URL || 'https://api.the-key.club').replace(/\/+$/, '');
  
  private hasCredentials = false;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private http: AxiosInstance;

  constructor() {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (clientId && clientSecret) {
      this.hasCredentials = true;
      this.logger.log('🔐 [KeyClub] Serviço iniciado. Modo: TOKEN (Seguro).');
    } else {
      this.hasCredentials = false;
      this.logger.error('❌ [KeyClub] Credenciais não encontradas no .env! O serviço vai falhar.');
    }

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PaylureGateway/2.0',
      },
      httpsAgent: new https.Agent({ 
        keepAlive: true, 
        maxSockets: 50,
        rejectUnauthorized: false 
      })
    });
  }

  private getHeaders() {
    return { 
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private async login(): Promise<string> {
    if (!this.hasCredentials) return '';

    const clientId = process.env.KEY_CLUB_CLIENT_ID?.trim();
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET?.trim();

    this.logger.log(`🔄 [KeyClub] Renovando token de acesso...`);
    
    try {
      const resp = await axios.post(`${this.baseUrl}/api/auth/login`, {
        client_id: clientId,
        client_secret: clientSecret,
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 15000
      });

      const token = resp.data?.token || resp.data?.accessToken || resp.data?.access_token;
      
      if (!token) throw new Error('API retornou sucesso mas sem token.');

      this.token = String(token).trim();
      // Token vale por 1 hora, renovamos com segurança em 50 min
      this.tokenExpiresAt = Date.now() + (3000 * 1000); 
      
      this.logger.log('✅ [KeyClub] Token renovado com sucesso!');
      return this.token;
      
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      this.logger.error(`❌ [KeyClub] Erro no LOGIN (${status}): ${JSON.stringify(data)}`);
      throw new Error(`Falha na autenticação KeyClub: ${status}`);
    }
  }

  private async ensureToken(): Promise<void> {
    if (!this.hasCredentials) return;
    // Se não tem token ou falta menos de 5 minutos para expirar
    if (!this.token || Date.now() >= (this.tokenExpiresAt - 300000)) {
      await this.login();
    }
  }

  // Wrapper inteligente que tenta a requisição e, se der erro de token, renova e tenta de novo
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.ensureToken();
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      
      // Se for erro de autenticação (401/403), tenta renovar 1 vez
      if ((status === 401 || status === 403) && this.hasCredentials) {
        this.logger.warn(`⚠️ [KeyClub] Token expirado (${status}). Tentando renovar...`);
        try {
          this.token = null;
          this.tokenExpiresAt = 0;
          await this.login();
          return await fn(); // Tenta de novo com token novo
        } catch (retryError) {
          throw new BadRequestException('Falha de comunicação com a adquirente (Auth).');
        }
      }

      const responseData = ax.response?.data as any;
      const msg = responseData?.message || JSON.stringify(responseData);
      
      this.logger.error(`❌ [KeyClub] Erro na operação: ${msg}`);
      throw new BadRequestException(typeof msg === 'string' ? msg : 'Erro na transação');
    }
  }

  async createDeposit(input: CreateDepositInput) {
    const amount = Number(input.amount);
    if (amount < 1) throw new BadRequestException('Valor mínimo R$ 1,00');

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId || `DEP-${Date.now()}`,
      clientCallbackUrl: input.clientCallbackUrl,
      payer: {
        name: input.payer.name || 'Cliente',
        email: input.payer.email,
        document: input.payer.document.replace(/\D/g, ''),
      },
    };

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.getHeaders(),
      });
      return resp.data;
    });
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    const amount = Number(input.amount);
    if (amount < 1) throw new BadRequestException('Valor mínimo R$ 1,00');

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description,
      clientCallbackUrl: input.clientCallbackUrl,
    };

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.getHeaders(),
      });
      return resp.data;
    });
  }
}