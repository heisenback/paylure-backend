// src/keyclub/keyclub.service.ts
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Injectable, Logger, UnauthorizedException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
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
  private readonly useWhitelist: boolean; // ✅ Flag para usar whitelist
  private token: string | null = null;
  private http: AxiosInstance;

  constructor() {
    // ✅ Detecta se deve usar whitelist ou token
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    const preset = (process.env.KEY_CLUB_ACCESS_TOKEN || '').trim();

    this.useWhitelist = !!(clientId && !preset); // Se tem CLIENT_ID mas não tem TOKEN, usa whitelist
    
    this.logger.log(`🔐 [KeyClub] Modo: ${this.useWhitelist ? 'WHITELIST (IP)' : 'TOKEN'}`);
    
    if (this.useWhitelist) {
      this.logger.log(`✅ [KeyClub] Usando IP na whitelist (CLIENT_ID: ${clientId.substring(0, 10)}...)`);
    } else if (preset) {
      this.token = preset;
      this.logger.log(`✅ [KeyClub] Usando TOKEN de acesso`);
    } else {
      this.logger.warn(`⚠️  [KeyClub] Nenhuma credencial configurada!`);
    }

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
      })
    });
  }

  private isCloudflareBlock(error: any): boolean {
    const res = error.response;
    if (!res) return false;
    
    const status = res.status;
    if (status !== 403 && status !== 503) return false;
    
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
    const isHtml = String(res.headers?.['content-type'] || '').toLowerCase().includes('text/html');
    
    return isHtml && (body.includes('Attention Required') || body.includes('cf-error-details'));
  }

  // ✅ NOVO: Gera headers baseado no modo (whitelist ou token)
  private getHeaders() {
    if (this.useWhitelist) {
      // ✅ IP Whitelist: sem Authorization
      this.logger.debug('📤 Usando headers SEM token (IP whitelist)');
      return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    }

    // ✅ Modo TOKEN: inclui Authorization
    if (!this.token) {
      throw new Error('Token de acesso não disponível.');
    }
    
    this.logger.debug(`📤 Usando headers COM token: ${this.token.substring(0, 20)}...`);
    return { 
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private async login(): Promise<string> {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Credenciais da KeyClub não configuradas.');
    }

    this.logger.log('🔄 [Keyclub] Tentando renovar token...');
    
    try {
      const resp = await axios.post(`${this.baseUrl}/api/auth/login`, {
        client_id: clientId,
        client_secret: clientSecret,
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: true })
      });

      const token = resp.data?.token || resp.data?.accessToken || resp.data?.access_token;
        
      if (!token) {
        throw new Error('Resposta de login vazia.');
      }

      this.token = String(token).trim();
      this.logger.log('✅ [Keyclub] Token renovado com sucesso.');
      return this.token;
      
    } catch (error) {
      this.logger.error(`❌ [Keyclub] Falha crítica no login: ${error.message}`);
      throw new InternalServerErrorException('Falha de comunicação com adquirente (Login).');
    }
  }

  // ✅ NOVO: Só tenta login se estiver em modo TOKEN
  private async ensureToken(): Promise<void> {
    if (this.useWhitelist) {
      // ✅ Modo whitelist: não precisa de token
      this.logger.debug('⏭️  Pulando login (usando IP whitelist)');
      return;
    }

    if (this.token) {
      // ✅ Já tem token válido
      return;
    }

    // ✅ Modo token mas sem token: tenta fazer login
    await this.login();
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      const responseData = JSON.stringify(ax.response?.data || {}).toLowerCase();

      // ✅ Se estiver em modo whitelist, não tenta retry com login
      if (this.useWhitelist) {
        this.logger.error(`❌ [Keyclub] Erro em modo whitelist: ${status} - ${responseData.substring(0, 100)}`);
        
        if (status === 401 || status === 403) {
          throw new BadRequestException('Acesso negado pela KeyClub. Verifique se o IP está na whitelist.');
        }
        
        throw error;
      }

      // ✅ Se estiver em modo TOKEN, tenta retry com novo login
      const isTokenError = 
        status === 401 || 
        status === 403 || 
        (status === 400 && (responseData.includes('token') || responseData.includes('unauthorized')));

      if (isTokenError && !this.isCloudflareBlock(error)) {
        this.logger.warn(`⚠️  [Keyclub] Erro de token (${status}). Tentando login novamente...`);
        
        this.token = null;
        try {
          await this.login();
          return await fn();
        } catch (retryError) {
          this.logger.error('❌ [Keyclub] Falha no retry:', retryError.message);
          throw new BadRequestException('Erro na adquirente: Falha de autenticação.');
        }
      }

      if (status === 400) {
        const msg = (ax.response?.data as any)?.message || 'Dados inválidos enviados para a KeyClub.';
        throw new BadRequestException(msg);
      }

      if (status === 401) {
        throw new InternalServerErrorException('Erro interno na integração de pagamentos.');
      }

      throw error;
    }
  }

  async createDeposit(input: CreateDepositInput) {
    await this.ensureToken();

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
        ...(input.payer.phone ? { phone: input.payer.phone.replace(/\D/g, '') } : {}),
      },
    };

    this.logger.log(`📤 [createDeposit] Enviando para KeyClub: ${JSON.stringify(payload).substring(0, 100)}...`);

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.getHeaders(),
      });
      
      this.logger.log(`✅ [createDeposit] Resposta: ${resp.status} - ${JSON.stringify(resp.data).substring(0, 100)}...`);
      return resp.data;
    });
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (amount < 1) throw new BadRequestException('Valor mínimo R$ 1,00');

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description || `Saque ${input.externalId}`,
      clientCallbackUrl: input.clientCallbackUrl,
    };

    this.logger.log(`📤 [createWithdrawal] Enviando para KeyClub: ${JSON.stringify(payload).substring(0, 100)}...`);

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.getHeaders(),
      });
      
      this.logger.log(`✅ [createWithdrawal] Resposta: ${resp.status} - ${JSON.stringify(resp.data).substring(0, 100)}...`);
      return resp.data;
    });
  }
}