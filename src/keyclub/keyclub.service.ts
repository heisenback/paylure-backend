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
  private readonly useWhitelist: boolean;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private http: AxiosInstance;

  constructor() {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    const forceWhitelist = (process.env.KEY_CLUB_USE_WHITELIST || '').toLowerCase() === 'true';

    // 🔍 DETECTA O MODO
    if (forceWhitelist) {
      this.useWhitelist = true;
      this.logger.log('🔐 [KeyClub] Modo: WHITELIST (IP) - Sem token necessário');
    } else if (clientId && clientSecret) {
      this.useWhitelist = false;
      this.logger.log('🔐 [KeyClub] Modo: TOKEN (login automático com renovação)');
    } else if (clientId && !clientSecret) {
      this.useWhitelist = true;
      this.logger.log('🔐 [KeyClub] Modo: WHITELIST (apenas CLIENT_ID detectado)');
    } else {
      throw new Error('❌ KeyClub não configurada. Defina CLIENT_ID ou CLIENT_ID + CLIENT_SECRET');
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

  private getHeaders() {
    if (this.useWhitelist) {
      this.logger.debug('📤 Headers sem token (modo whitelist por IP)');
      return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    }

    if (!this.token) {
      throw new Error('Token não disponível');
    }
    
    this.logger.debug(`📤 Headers com token: ${this.token.substring(0, 20)}...`);
    return { 
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private isTokenExpired(): boolean {
    if (this.useWhitelist) return false;
    if (!this.tokenExpiresAt) return true;
    
    // Renova 2 minutos antes de expirar (margem de segurança)
    return Date.now() >= (this.tokenExpiresAt - 120000);
  }

  private async login(): Promise<string> {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('CLIENT_ID e CLIENT_SECRET são obrigatórios para login');
    }

    this.logger.log('🔄 [KeyClub] Fazendo login para obter novo token...');
    
    try {
      const resp = await axios.post(`${this.baseUrl}/api/auth/login`, {
        client_id: clientId,
        client_secret: clientSecret,
      }, {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: new https.Agent({ rejectUnauthorized: true }),
        timeout: 15000
      });

      const token = resp.data?.token || resp.data?.accessToken || resp.data?.access_token;
      const expiresIn = resp.data?.expires_in || resp.data?.expiresIn || 3600;
        
      if (!token) {
        this.logger.error(`❌ Resposta de login sem token: ${JSON.stringify(resp.data)}`);
        throw new Error('Login não retornou token');
      }

      this.token = String(token).trim();
      this.tokenExpiresAt = Date.now() + (expiresIn * 1000);
      
      const expiresInMin = Math.floor(expiresIn / 60);
      this.logger.log(`✅ [KeyClub] Token obtido com sucesso (válido por ${expiresInMin} minutos)`);
      
      return this.token;
      
    } catch (error) {
      const axError = error as AxiosError;
      const status = axError.response?.status;
      const data = axError.response?.data;
      
      this.logger.error(`❌ [KeyClub] Erro no login: ${status} - ${JSON.stringify(data)}`);
      
      if (status === 401 || status === 403) {
        throw new InternalServerErrorException('Credenciais inválidas (CLIENT_ID ou CLIENT_SECRET incorretos)');
      }
      
      throw new InternalServerErrorException('Falha ao fazer login na KeyClub');
    }
  }

  private async ensureToken(): Promise<void> {
    if (this.useWhitelist) {
      this.logger.debug('⏭️ Modo whitelist ativo - sem token necessário');
      return;
    }

    // 🔄 Verifica se precisa renovar o token
    if (!this.token || this.isTokenExpired()) {
      this.logger.warn('⚠️ Token ausente ou próximo de expirar - renovando...');
      await this.login();
    } else {
      const timeLeft = Math.floor((this.tokenExpiresAt - Date.now()) / 60000);
      this.logger.debug(`✅ Token válido (expira em ${timeLeft} minutos)`);
    }
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      const responseData = ax.response?.data;
      const dataStr = JSON.stringify(responseData || {}).toLowerCase();

      this.logger.error(`❌ [KeyClub] Erro ${status}: ${JSON.stringify(responseData)}`);

      // ❌ MODO WHITELIST: Não tenta retry com login
      if (this.useWhitelist) {
        if (status === 401 || status === 403) {
          throw new BadRequestException(
            'Acesso negado pela KeyClub. ' +
            'Verifique se o IP do servidor está na whitelist. ' +
            'Se deveria usar TOKEN, remova KEY_CLUB_USE_WHITELIST do .env'
          );
        }
        
        if (status === 400) {
          const msg = (responseData as any)?.message || 'Dados inválidos';
          throw new BadRequestException(`KeyClub: ${msg}`);
        }
        
        throw new InternalServerErrorException(`Erro KeyClub: ${status}`);
      }

      // 🔄 MODO TOKEN: Tenta renovar em caso de erro de autenticação
      const isAuthError = 
        status === 401 || 
        status === 403 || 
        dataStr.includes('token') ||
        dataStr.includes('unauthorized') ||
        dataStr.includes('invalid') ||
        dataStr.includes('expired');

      if (isAuthError && !this.isCloudflareBlock(error)) {
        this.logger.warn(`⚠️ Detectado erro de autenticação. Renovando token e tentando novamente...`);
        
        try {
          // Força renovação do token
          this.token = null;
          this.tokenExpiresAt = 0;
          await this.login();
          
          this.logger.log('🔄 Tentando novamente com novo token...');
          return await fn();
          
        } catch (retryError) {
          this.logger.error(`❌ Falha no retry: ${retryError.message}`);
          throw new BadRequestException(
            'Falha de autenticação com KeyClub. ' +
            'Verifique se CLIENT_ID e CLIENT_SECRET estão corretos.'
          );
        }
      }

      // Outros erros
      if (status === 400) {
        const msg = (responseData as any)?.message || 'Dados inválidos';
        throw new BadRequestException(`KeyClub: ${msg}`);
      }

      throw new InternalServerErrorException(`Erro KeyClub: ${status}`);
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

    this.logger.log(`📤 [createDeposit] Enviando depósito: R$ ${amount.toFixed(2)}`);

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.getHeaders(),
      });
      
      this.logger.log(`✅ [createDeposit] Sucesso: ${resp.status}`);
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

    this.logger.log(`📤 [createWithdrawal] Enviando saque: R$ ${amount.toFixed(2)}`);

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.getHeaders(),
      });
      
      this.logger.log(`✅ [createWithdrawal] Sucesso: ${resp.status}`);
      return resp.data;
    });
  }
}