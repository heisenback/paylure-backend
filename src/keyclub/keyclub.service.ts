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
  
  // Remove aspas extras se existirem e remove barra do final
  private cleanUrl(url: string | undefined): string {
    if (!url) return '';
    return url.replace(/"/g, '').trim().replace(/\/+$/, '');
  }

  private readonly baseUrl = this.cleanUrl(process.env.KEY_CLUB_BASE_URL || 'https://api.the-key.club');
  
  private hasCredentials = false;
  private token: string | null = null;
  private tokenExpiresAt: number = 0; 
  private http: AxiosInstance;

  constructor() {
    // Remove aspas das credenciais caso existam no .env
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').replace(/"/g, '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').replace(/"/g, '').trim();
    
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
        'User-Agent': 'PaylureGateway/2.1-AutoRenew',
      },
      httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false })
    });
  }

  async onModuleInit() {
    if (this.hasCredentials) {
        try {
            this.logger.log('🔌 [KeyClub] Verificando credenciais iniciais...');
            await this.login();
        } catch (e) {
            this.logger.warn('⚠️ [KeyClub] Falha no login inicial. O sistema tentará novamente na primeira transação.');
        }
    }
  }

  private async login(): Promise<string> {
    if (!this.hasCredentials) throw new Error('Sem credenciais KeyClub configuradas.');

    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').replace(/"/g, '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').replace(/"/g, '').trim();

    this.logger.log(`🔄 [KeyClub] Obtendo NOVO Token de Acesso...`);
    
    try {
      const loginResponse = await axios.post(`${this.baseUrl}/api/auth/login`, {
        client_id: clientId,
        client_secret: clientSecret,
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 10000
      });

      const token = loginResponse.data?.token || loginResponse.data?.accessToken || loginResponse.data?.access_token;
      
      if (!token) {
        throw new Error('API retornou 200 OK mas não enviou o token.');
      }

      this.token = String(token).trim();
      this.tokenExpiresAt = Date.now() + (45 * 60 * 1000); 
      
      this.logger.log('✅ [KeyClub] Token renovado com sucesso.');
      return this.token;
      
    } catch (error: any) {
      const status = error.response?.status || 'Erro';
      const msg = error.response?.data?.message || error.message;
      this.logger.error(`❌ [KeyClub] Falha Crítica no Login (${status}): ${msg}`);
      throw new Error(`Falha de autenticação no Gateway: ${msg}`);
    }
  }

  private async ensureToken(): Promise<void> {
    if (!this.hasCredentials) return;
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      this.logger.warn('⚠️ [KeyClub] Token expirado ou inexistente. Renovando antes da requisição...');
      await this.login();
    }
  }

  private async withAuthRetry<T>(operation: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      await this.ensureToken();
      return await operation();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      const errorData = ax.response?.data as any;
      const errorMessage = JSON.stringify(errorData || '').toLowerCase();

      const isAuthError = status === 401 || status === 403 || errorMessage.includes('token') || errorMessage.includes('unauthorized');

      if (isAuthError && attempt === 1 && this.hasCredentials) {
        this.logger.warn(`🛑 [KeyClub] Token rejeitado (Status: ${status}). Renovando e retentando...`);
        this.token = null;
        this.tokenExpiresAt = 0;
        try {
          await this.login();
          return await this.withAuthRetry(operation, 2); 
        } catch (retryErr) {
          throw new BadRequestException('Falha de comunicação com Gateway (Retry Failed).');
        }
      }
      const finalMsg = errorData?.message || errorData?.error || 'Erro desconhecido no Gateway';
      this.logger.error(`❌ [KeyClub] Erro na Operação: ${finalMsg}`);
      throw new BadRequestException(typeof finalMsg === 'string' ? finalMsg : 'Erro ao processar pagamento.');
    }
  }

  private getHeaders() {
    return { 
        Authorization: `Bearer ${this.token}`, 
        'Content-Type': 'application/json',
        'Accept': 'application/json' 
    };
  }

  /**
   * Helper que lê as variáveis exatas do seu .env
   */
  private getCallbackUrl(providedUrl?: string): string {
    // 1. Se o controller mandou, usa o que mandou
    if (providedUrl) return providedUrl;

    // 2. Tenta pegar a variável exata KEY_CLUB_CALLBACK_URL do seu .env
    // Ela já está como: "https://api.paylure.com.br/api/v1/webhooks/keyclub"
    let envCallback = process.env.KEY_CLUB_CALLBACK_URL;
    if (envCallback) {
        return envCallback.replace(/"/g, '').trim();
    }

    // 3. Se não achar, tenta montar usando BASE_URL
    const baseUrl = process.env.BASE_URL;
    if (baseUrl) {
        const cleanBase = baseUrl.replace(/"/g, '').trim().replace(/\/+$/, '');
        // Adiciona /api/v1 pois geralmente apps NestJS usam esse prefixo global
        return `${cleanBase}/api/v1/webhooks/keyclub`;
    }

    this.logger.error('❌ ERRO GRAVE: Nenhuma URL de Callback configurada (KEY_CLUB_CALLBACK_URL ou BASE_URL ausentes no .env). O Dashboard não vai atualizar!');
    return '';
  }

  async createDeposit(input: CreateDepositInput) {
    if (!input.amount || input.amount < 1) throw new BadRequestException('Valor inválido (Mín R$ 1,00)');

    const callbackUrl = this.getCallbackUrl(input.clientCallbackUrl);
    this.logger.log(`🔗 [CreateDeposit] Callback URL definida: ${callbackUrl}`);

    const payload = {
      amount: Number(input.amount.toFixed(2)),
      external_id: input.externalId || `DEP-${Date.now()}`,
      clientCallbackUrl: callbackUrl,
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
    const callbackUrl = this.getCallbackUrl(input.clientCallbackUrl);
    
    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description,
      clientCallbackUrl: callbackUrl,
    };

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, { headers: this.getHeaders() });
      return resp.data;
    });
  }
}