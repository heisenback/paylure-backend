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
        rejectUnauthorized: true // Mantenha true para produção segura
      })
    });

    // Tenta usar token do env, mas se falhar, o sistema vai se recuperar sozinho
    const preset = (process.env.KEY_CLUB_ACCESS_TOKEN || '').trim();
    if (preset) {
      this.token = preset;
    }
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

  // Gera headers na hora da chamada para pegar o token atualizado
  private getHeaders() {
    if (!this.token) {
      throw new Error('Token de acesso não disponível. O login falhou.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private async login(): Promise<string> {
    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Credenciais da KeyClub não configuradas.');
    }

    this.logger.log('🔄 [Keyclub] Tentando renovar token...');
    
    try {
      // Instância limpa para login
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

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return await this.login();
  }

  // Wrapper inteligente para retry
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      const responseData = JSON.stringify(ax.response?.data || {}).toLowerCase();

      // Detecção de Token Inválido (Mesmo se for 400 ou 500)
      const isTokenError = 
        status === 401 || 
        status === 403 || 
        (status === 400 && (responseData.includes('token') || responseData.includes('unauthorized')));

      if (isTokenError && !this.isCloudflareBlock(error)) {
        this.logger.warn(`⚠️ [Keyclub] Erro de token (${status}). Tentando login novamente...`);
        
        this.token = null; // Força limpeza
        try {
          await this.login(); // Busca novo token
          return await fn();  // Tenta operação novamente
        } catch (retryError) {
          this.logger.error('❌ [Keyclub] Falha no retry:', retryError.message);
          // IMPORTANTE: Não lançar 401 aqui para não deslogar o usuário do dashboard
          throw new BadRequestException('Erro na adquirente: Falha de autenticação.');
        }
      }

      // Tratamento de erros para não quebrar o frontend
      if (status === 400) {
         const msg = (ax.response?.data as any)?.message || 'Dados inválidos enviados para a KeyClub.';
         throw new BadRequestException(msg);
      }

      // Se for erro 401 da Keyclub que não resolveu com retry, transformamos em 500
      // para o Frontend do Paylure não achar que o usuário deslogou.
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

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, {
        headers: this.getHeaders(), // Usa o getter dinâmico
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

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, {
        headers: this.getHeaders(),
      });
      return resp.data;
    });
  }
}