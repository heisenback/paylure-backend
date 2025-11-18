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
      validateStatus: () => true,
    });

    const preset = (process.env.KEY_CLUB_ACCESS_TOKEN || '').trim();
    if (preset) {
      this.token = preset;
      this.logger.log('✅ [KeyclubService] Usando KEY_CLUB_ACCESS_TOKEN do .env');
    } else {
      this.logger.warn('⚠️ [KeyclubService] KEY_CLUB_ACCESS_TOKEN não encontrado, login automático será usado');
    }
  }

  private isCloudflareBlock(ax: AxiosError<any>): boolean {
    const res = ax.response;
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
    
    const isWafBlock = isHtml && hasWafSignature;
    
    if (isWafBlock) {
      this.logger.error('🚫 BLOQUEIO WAF REAL DETECTADO:', {
        status,
        contentType,
        bodyPreview: body.slice(0, 200)
      });
    }
    
    return isWafBlock;
  }

  private authHeaders() {
    if (!this.token) {
      this.logger.error('❌ [KeyclubService] Token ausente ao tentar adicionar headers');
      throw new Error('Token não disponível. Login necessário.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private async login(): Promise<string> {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      this.logger.error('❌ [KeyclubService] KEY_CLUB_CLIENT_ID ou CLIENT_SECRET ausentes');
      throw new Error('Credenciais da KeyClub ausentes no .env');
    }

    this.logger.log('🔍 [KeyclubService] Iniciando autenticação...');
    this.logger.log(`🔍 CLIENT_ID: ${clientId.slice(0, 20)}...`);
    
    try {
      const resp = await this.http.post('/api/auth/login', {
        client_id: clientId,
        client_secret: clientSecret,
      });

      this.logger.log(`📥 [KeyclubService] Login response: status=${resp.status}`);
      this.logger.log(`📥 [KeyclubService] Response body: ${JSON.stringify(resp.data).slice(0, 200)}`);

      if (resp.status === 200 || resp.status === 201) {
        // 🔥 CORREÇÃO: A resposta da KeyClub tem o campo "token" diretamente
        const token = resp.data?.token || resp.data?.accessToken || resp.data?.access_token;
        
        if (!token) {
          this.logger.error('❌ [KeyclubService] Token não encontrado na resposta:', resp.data);
          throw new Error('Token não retornado pela API da KeyClub');
        }

        this.token = String(token).trim();
        this.logger.log('✅ [KeyclubService] Autenticação bem-sucedida!');
        this.logger.log(`🔑 Token (primeiros 30 chars): ${this.token.slice(0, 30)}...`);
        return this.token;
      }

      if (resp.status === 403) {
        if (this.isCloudflareBlock({ response: resp } as any)) {
          throw new Error('Login bloqueado pelo Cloudflare WAF real. Contate o suporte da KeyClub');
        }
        throw new Error('Credenciais inválidas (403). Verifique CLIENT_ID/SECRET');
      }

      if (resp.status === 401) {
        throw new Error('Credenciais inválidas (401). Verifique CLIENT_ID/SECRET');
      }

      this.logger.error(
        `❌ [KeyclubService] Login falhou: status=${resp.status} ` +
        `body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(`Falha no login: HTTP ${resp.status}`);
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error('❌ [KeyclubService] Erro de rede:', error.message);
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Não foi possível conectar à API da KeyClub');
        }
      }
      throw error;
    }
  }

  // 🔥 CORREÇÃO CRÍTICA: Garante que SEMPRE terá token antes de fazer requisições
  private async ensureToken(force = false): Promise<string> {
    // Se já tem token e não está forçando novo login
    if (this.token && !force) {
      this.logger.log('✅ [KeyclubService] Token já disponível');
      return this.token;
    }
    
    // Se não tem token OU está forçando, faz login
    this.logger.log('🔄 [KeyclubService] Obtendo novo token...');
    return await this.login();
  }

  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const ax = e as AxiosError<any>;
      const status = ax.response?.status;

      if (ax.response && this.isCloudflareBlock(ax)) {
        this.logger.error('❌ [KeyclubService] Bloqueio WAF REAL do Cloudflare detectado');
        throw new Error('Requisição bloqueada pelo WAF. Contate o suporte da KeyClub');
      }

      if (status === 401 || status === 403) {
        const usingFixedToken = Boolean((process.env.KEY_CLUB_ACCESS_TOKEN || '').trim());
        
        if (usingFixedToken) {
          this.logger.error('❌ [KeyclubService] Token fixo inválido ou expirado');
          throw new Error('KEY_CLUB_ACCESS_TOKEN inválido ou expirado. Gere um novo token');
        }
        
        this.logger.warn('⚠️ [KeyclubService] Token expirado, reautenticando...');
        this.token = null;
        await this.ensureToken(true);
        return await fn();
      }

      throw e;
    }
  }

  async createDeposit(input: CreateDepositInput) {
    // 🔥 CORREÇÃO: SEMPRE garante token antes de fazer requisição
    this.logger.log('🔍 [KeyclubService] Verificando token antes de criar depósito...');
    
    try {
      await this.ensureToken(); // Vai fazer login se necessário
    } catch (error) {
      this.logger.error('❌ [KeyclubService] Falha ao obter token:', error);
      throw new Error('Não foi possível autenticar na KeyClub');
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new Error('Valor mínimo para depósito é R$ 1,00');
    }

    const externalId =
      input.externalId?.trim() || `DEP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const clientCallbackUrl =
      input.clientCallbackUrl ||
      process.env.KEY_CLUB_CALLBACK_URL ||
      `${process.env.BASE_URL || ''}/api/v1/webhooks/keyclub`.replace(/\/+/g, '/');

    const document = input.payer?.document?.toString().replace(/\D/g, '');
    
    if (!document) {
      throw new Error('Documento do pagador é obrigatório');
    }
    
    if (document.length !== 11 && document.length !== 14) {
      throw new Error(`Documento inválido: deve ter 11 (CPF) ou 14 (CNPJ) dígitos. Recebido: ${document.length}`);
    }

    const email = input.payer.email?.trim();
    if (!email || !email.includes('@')) {
      throw new Error('Email inválido');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: externalId,
      clientCallbackUrl,
      payer: {
        name: input.payer.name?.trim() || 'Cliente',
        email: email,
        document: document,
        ...(input.payer.phone ? { phone: input.payer.phone.replace(/\D/g, '') } : {}),
      },
    };

    this.logger.log(
      `📤 [KeyclubService] Criando depósito: ` +
      `amount=R$${payload.amount} external_id=${externalId} doc=${document}`
    );

    const exec = async () => {
      if (!this.token) {
        throw new Error('Token não disponível para criar depósito');
      }

      const headersToSend = this.authHeaders();
      this.logger.log(`🔍 [DEBUG] Token existe: ${!!this.token}`);
      this.logger.log(`🔍 [DEBUG] Token (30 chars): ${this.token?.slice(0, 30)}...`);

      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: headersToSend,
      });

      this.logger.log(
        `📥 [KeyclubService] Resposta: status=${resp.status} ` +
        `data=${JSON.stringify(resp.data).slice(0, 200)}`
      );

      if (resp.status === 201 || resp.status === 200) {
        this.logger.log(`✅ [KeyclubService] Depósito criado: ${externalId}`);
        return resp.data;
      }

      if (resp.status === 403) {
        if (this.isCloudflareBlock({ response: resp } as any)) {
          this.logger.error('❌ Bloqueio WAF REAL - Headers:', resp.headers);
          throw new Error('Bloqueado pelo Cloudflare WAF');
        }
        
        const errorMsg = resp.data?.message || resp.data?.error || 'Acesso negado';
        this.logger.error(`❌ [KeyclubService] 403 da API (não é WAF): ${errorMsg}`);
        throw new Error(`Acesso negado pela KeyClub: ${errorMsg}`);
      }

      if (resp.status === 401) {
        throw new Error('Token inválido ou expirado');
      }

      if (resp.status === 400) {
        const errorMsg = resp.data?.message || resp.data?.error || 'Dados inválidos';
        this.logger.error(`❌ [KeyclubService] Erro 400: ${errorMsg}`);
        throw new Error(`Erro de validação: ${errorMsg}`);
      }

      if (resp.status >= 500) {
        throw new Error('Gateway KeyClub temporariamente indisponível');
      }

      this.logger.error(
        `❌ [KeyclubService] Erro desconhecido: status=${resp.status} ` +
        `body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(resp.data?.message || `Erro HTTP ${resp.status} ao criar depósito`);
    };

    return this.withAuthRetry(exec);
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    // 🔥 CORREÇÃO: Mesma lógica para saques
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new Error('Valor mínimo para saque é R$ 1,00');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description || `Saque ${input.externalId}`,
      clientCallbackUrl: input.clientCallbackUrl,
    };

    this.logger.log(`📤 [KeyclubService] Criando saque: ${input.externalId} R$${amount}`);

    const exec = async () => {
      if (!this.token) {
        throw new Error('Token não disponível para criar saque');
      }

      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.authHeaders(),
      });

      this.logger.log(`📥 [KeyclubService] Resposta saque: status=${resp.status}`);

      if (resp.status === 200 || resp.status === 201) {
        this.logger.log(`✅ [KeyclubService] Saque criado: ${payload.external_id}`);
        return resp.data;
      }

      if (resp.status === 403) {
        if (this.isCloudflareBlock({ response: resp } as any)) {
          throw new Error('Saque bloqueado pelo Cloudflare WAF');
        }
        const errorMsg = resp.data?.message || 'Acesso negado';
        throw new Error(`Acesso negado pela KeyClub: ${errorMsg}`);
      }

      if (resp.status === 401) {
        throw new Error('Token inválido ou expirado');
      }

      if (resp.status === 400) {
        const errorMsg = resp.data?.message || 'Dados inválidos';
        throw new Error(`Erro de validação: ${errorMsg}`);
      }

      this.logger.error(
        `❌ [KeyclubService] Saque falhou: status=${resp.status} ` +
        `body=${JSON.stringify(resp.data).slice(0, 400)}`
      );
      throw new Error(resp.data?.message || `Erro HTTP ${resp.status} ao criar saque`);
    };

    return this.withAuthRetry(exec);
  }
}