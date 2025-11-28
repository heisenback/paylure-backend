// src/keyclub/keyclub.service.ts
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import * as https from 'https';

type CreateDepositInput = {
  amount: number;
  externalId?: string;
  clientCallbackUrl?: string;
  payer: { name: string; email: string; document: string; phone?: string; };
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
export class KeyclubService implements OnModuleInit {
  private readonly logger = new Logger(KeyclubService.name);
  private readonly baseUrl = (process.env.KEY_CLUB_BASE_URL || 'https://api.the-key.club').replace(/\/+$/, '');
  
  private hasCredentials = false;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private http: AxiosInstance;
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (clientId && clientSecret) {
      this.hasCredentials = true;
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
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50, rejectUnauthorized: false })
    });
  }

  // 🔥 1. INICIA O SISTEMA ASSIM QUE O BACKEND LIGA
  async onModuleInit() {
    if (this.hasCredentials) {
        this.logger.log('💓 [KeyClub] Iniciando Heartbeat (Renovação Automática)...');
        await this.login(); // Primeiro login
        this.startHeartbeat(); // Inicia o ciclo
    }
  }

  // 🔥 2. O CORAÇÃO DO SISTEMA (Roda a cada 45 minutos)
  private startHeartbeat() {
    // 45 minutos em milissegundos = 45 * 60 * 1000
    const INTERVAL_MS = 45 * 60 * 1000; 

    this.heartbeatInterval = setInterval(async () => {
        this.logger.log('💓 [KeyClub Heartbeat] Verificando saúde do token...');
        try {
            await this.login();
        } catch (e) {
            this.logger.error('❌ [KeyClub Heartbeat] Falha ao renovar token em segundo plano.');
        }
    }, INTERVAL_MS);
  }

  // Método de diagnóstico manual (para você testar)
  async checkStatus() {
    if (!this.hasCredentials) return { status: 'ERROR', message: 'Sem credenciais' };
    const minutesLeft = Math.floor((this.tokenExpiresAt - Date.now()) / 60000);
    return { status: 'OK', message: 'Sistema Online', expiresIn: `${minutesLeft} minutos` };
  }

  private getHeaders() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  }

  private async login(): Promise<string> {
    if (!this.hasCredentials) return '';
    const clientId = process.env.KEY_CLUB_CLIENT_ID?.trim();
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET?.trim();

    // Log discreto apenas para debug interno
    // this.logger.debug(`🔄 [KeyClub] Renovando token...`);
    
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
      this.tokenExpiresAt = Date.now() + (3000 * 1000); // Validade teórica de 50 min
      
      this.logger.log('✅ [KeyClub] Token ativo e renovado.');
      return this.token;
      
    } catch (error: any) {
      const status = error.response?.status || 'Unknown';
      this.logger.error(`❌ [KeyClub] Falha no Login (${status})`);
      throw new Error(`Falha auth KeyClub`);
    }
  }

  private async ensureToken(): Promise<void> {
    if (!this.hasCredentials) return;
    // Se o token venceu ou está prestes a vencer (menos de 5 min), força login
    if (!this.token || Date.now() >= (this.tokenExpiresAt - 300000)) {
      await this.login();
    }
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.ensureToken();
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      
      // Se der erro de token, tenta renovar na hora e repetir a operação
      if ((status === 401 || status === 403) && this.hasCredentials) {
        this.logger.warn(`⚠️ [KeyClub] Token rejeitado (${status}). Tentando recuperação imediata...`);
        try {
          this.token = null;
          this.tokenExpiresAt = 0;
          await this.login(); // Login forçado
          return await fn();  // Tenta de novo a operação do cliente
        } catch (retryError) {
          throw new BadRequestException('Erro de comunicação com o banco (Auth). Tente novamente.');
        }
      }

      const responseData = ax.response?.data as any;
      const msg = responseData?.message || JSON.stringify(responseData);
      this.logger.error(`❌ [KeyClub] Erro Operacional: ${msg}`);
      throw new BadRequestException(typeof msg === 'string' ? msg : 'Erro ao processar transação.');
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
      const resp = await this.http.post('/api/payments/deposit', payload, { headers: this.getHeaders() });
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
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, { headers: this.getHeaders() });
      return resp.data;
    });
  }
}