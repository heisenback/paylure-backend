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
    
    // 🔥 LÓGICA DEFINITIVA: Se tem senha, USA A SENHA.
    // Ignora o KEY_CLUB_USE_WHITELIST se as credenciais existirem, pois Token é mais seguro.
    if (clientId && clientSecret) {
      this.hasCredentials = true;
      this.logger.log('🔐 [KeyClub] Credenciais detectadas. Modo: TOKEN (Mais estável)');
    } else {
      this.hasCredentials = false;
      this.logger.warn('⚠️ [KeyClub] Sem Client Secret. Modo: WHITELIST (Depende do IP estar liberado)');
    }

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'PaymentGateway/2.0',
      },
      httpsAgent: new https.Agent({ 
        keepAlive: true, 
        maxSockets: 50,
        rejectUnauthorized: true
      })
    });
  }

  private getHeaders() {
    // Se não tem credenciais, tenta ir sem token (modo whitelist puro)
    if (!this.hasCredentials) {
      return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    }

    // Se tem credenciais mas não tem token, é um erro de fluxo (deveria ter logado antes)
    if (!this.token) {
        this.logger.warn('⚠️ Token não encontrado no momento do header. Tentando prosseguir...');
    }
    
    return { 
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private isTokenExpired(): boolean {
    if (!this.hasCredentials) return false;
    if (!this.token || !this.tokenExpiresAt) return true;
    // Renova 5 minutos antes de expirar
    return Date.now() >= (this.tokenExpiresAt - 300000);
  }

  private async login(): Promise<string> {
    if (!this.hasCredentials) return '';

    const clientId = process.env.KEY_CLUB_CLIENT_ID;
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET;

    this.logger.log('🔄 [KeyClub] Renovando token de acesso...');
    
    try {
      const resp = await axios.post(`${this.baseUrl}/api/auth/login`, {
        client_id: clientId,
        client_secret: clientSecret,
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: true }),
        timeout: 10000
      });

      const token = resp.data?.token || resp.data?.accessToken || resp.data?.access_token;
      // Define 50 minutos de validade padrão se a API não retornar (segurança)
      const expiresIn = resp.data?.expires_in || 3600; 
        
      if (!token) {
        throw new Error('Login retornou sucesso mas sem token.');
      }

      this.token = String(token).trim();
      this.tokenExpiresAt = Date.now() + (expiresIn * 1000);
      
      this.logger.log('✅ [KeyClub] Token renovado com sucesso!');
      return this.token;
      
    } catch (error) {
      this.logger.error(`❌ [KeyClub] Falha no login: ${(error as any).message}`);
      throw error;
    }
  }

  private async ensureToken(): Promise<void> {
    if (!this.hasCredentials) return;

    if (this.isTokenExpired()) {
      await this.login();
    }
  }

  // 🔥 O SEGREDO DA CORREÇÃO ESTÁ AQUI
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      // 1. Tenta executar a requisição
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      
      // 2. Se der erro de autenticação (401/403) E nós temos credenciais configuradas
      if ((status === 401 || status === 403) && this.hasCredentials) {
        this.logger.warn(`⚠️ [KeyClub] Erro ${status} (Token inválido/expirado). Tentando renovar e repetir...`);
        
        try {
          // Força renovação do token
          this.token = null;
          this.tokenExpiresAt = 0;
          await this.login();
          
          // 3. Tenta de novo com o token novo
          return await fn();
        } catch (retryError) {
          this.logger.error(`❌ [KeyClub] Erro fatal após tentativa de renovação.`);
          throw new BadRequestException('Falha de comunicação com a adquirente (Auth).');
        }
      }

      // Tratamento de outros erros
      const responseData = ax.response?.data as any;
      if (status === 400) {
        const msg = responseData?.message || JSON.stringify(responseData);
        throw new BadRequestException(`KeyClub: ${msg}`);
      }

      this.logger.error(`❌ [KeyClub] Erro ${status}: ${JSON.stringify(responseData)}`);
      throw new InternalServerErrorException('Erro ao processar pagamento na KeyClub.');
    }
  }

  async createDeposit(input: CreateDepositInput) {
    // Garante token antes de começar
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

    this.logger.log(`📤 [Deposit] Enviando R$ ${amount.toFixed(2)}...`);

    return this.withAuthRetry(async () => {
      // Pega os headers na hora da execução para garantir que o token esteja atualizado
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.getHeaders(),
      });
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

    this.logger.log(`📤 [Withdrawal] Enviando R$ ${amount.toFixed(2)}...`);

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.getHeaders(),
      });
      return resp.data;
    });
  }
}