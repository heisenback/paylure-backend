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
  // Reduzi o tempo de segurança para forçar renovação antes de expirar
  private tokenExpiresAt: number = 0; 
  private http: AxiosInstance;

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
        'User-Agent': 'PaylureGateway/2.1-AutoRenew',
      },
      // Mantém conexão viva para ser mais rápido
      httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false })
    });
  }

  async onModuleInit() {
    if (this.hasCredentials) {
        // Tenta um login inicial apenas para validar credenciais no boot
        try {
            this.logger.log('🔌 [KeyClub] Verificando credenciais iniciais...');
            await this.login();
        } catch (e) {
            this.logger.warn('⚠️ [KeyClub] Falha no login inicial. O sistema tentará novamente na primeira transação.');
        }
    }
  }

  /**
   * Realiza o login na API e salva o token na memória
   */
  private async login(): Promise<string> {
    if (!this.hasCredentials) throw new Error('Sem credenciais KeyClub configuradas.');

    const clientId = process.env.KEY_CLUB_CLIENT_ID?.trim();
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET?.trim();

    this.logger.log(`🔄 [KeyClub] Obtendo NOVO Token de Acesso...`);
    
    try {
      // Cria uma instância limpa do axios para o login (sem headers antigos)
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
      // Define expiração segura (45 minutos a partir de agora)
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

  /**
   * Garante que existe um token válido antes de fazer a requisição.
   */
  private async ensureToken(): Promise<void> {
    if (!this.hasCredentials) return;

    // Se não tem token OU se já passou do tempo de expiração
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      this.logger.warn('⚠️ [KeyClub] Token expirado ou inexistente. Renovando antes da requisição...');
      await this.login();
    }
  }

  /**
   * Wrapper Mágico: Executa a função, se der erro 401 (Auth), faz login e tenta de novo.
   */
  private async withAuthRetry<T>(operation: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      // 1. Garante token antes de tentar
      await this.ensureToken();
      
      // 2. Tenta executar a operação
      return await operation();

    } catch (error) {
      const ax = error as AxiosError;
      const status = ax.response?.status;
      const errorData = ax.response?.data as any;
      const errorMessage = JSON.stringify(errorData || '').toLowerCase();

      // LOGICA DE RETRY (Se for erro de token/auth e for a primeira tentativa)
      const isAuthError = status === 401 || status === 403 || errorMessage.includes('token') || errorMessage.includes('unauthorized');

      if (isAuthError && attempt === 1 && this.hasCredentials) {
        this.logger.warn(`🛑 [KeyClub] Token rejeitado pela API (Status: ${status}). Forçando renovação imediata e retentando...`);
        
        // Força limpeza do token para obrigar o login
        this.token = null;
        this.tokenExpiresAt = 0;
        
        try {
          // Faz login forçado
          await this.login();
          // 🔥 RECURSIVIDADE: Chama a mesma função de novo (attempt 2)
          return await this.withAuthRetry(operation, 2); 
        } catch (retryErr) {
          this.logger.error('❌ [KeyClub] Falha na segunda tentativa após renovar token.');
          throw new BadRequestException('Falha de comunicação com Gateway (Retry Failed).');
        }
      }

      // Se não for erro de Auth ou já for a segunda tentativa, estoura o erro real
      const finalMsg = errorData?.message || errorData?.error || 'Erro desconhecido no Gateway';
      this.logger.error(`❌ [KeyClub] Erro na Operação: ${finalMsg}`);
      throw new BadRequestException(typeof finalMsg === 'string' ? finalMsg : 'Erro ao processar pagamento.');
    }
  }

  // --- MÉTODOS PÚBLICOS ---

  private getHeaders() {
    return { 
        Authorization: `Bearer ${this.token}`, 
        'Content-Type': 'application/json',
        'Accept': 'application/json' 
    };
  }

  /**
   * Helper para determinar a URL de Callback correta automaticamente
   */
  private getCallbackUrl(providedUrl?: string): string {
    // 1. Se foi passado manualmente pelo controller, usa o manual
    if (providedUrl) return providedUrl;

    // 2. Se não, tenta pegar do ENV (Isso é o que faltava)
    // Exemplo: https://api.paylure.com.br
    const apiBase = process.env.API_BASE_URL; 
    
    if (apiBase) {
        // Remove barra final se tiver e adiciona o caminho do webhook
        const cleanBase = apiBase.replace(/\/+$/, '');
        return `${cleanBase}/webhooks/keyclub`;
    }

    // 3. Se não tiver nada configurado, avisa no log (Erro de configuração)
    this.logger.warn('⚠️ ATENÇÃO: Nenhuma URL de API configurada (API_BASE_URL). O Webhook NÃO VAI CHEGAR.');
    return '';
  }

  async createDeposit(input: CreateDepositInput) {
    if (!input.amount || input.amount < 1) throw new BadRequestException('Valor inválido (Mín R$ 1,00)');

    // Gera a URL correta
    const callbackUrl = this.getCallbackUrl(input.clientCallbackUrl);
    this.logger.log(`🔗 [CreateDeposit] Callback URL definida: ${callbackUrl}`);

    const payload = {
      amount: Number(input.amount.toFixed(2)),
      external_id: input.externalId || `DEP-${Date.now()}`,
      clientCallbackUrl: callbackUrl, // Envia a URL calculada
      payer: {
        name: input.payer.name || 'Cliente',
        email: input.payer.email,
        document: input.payer.document.replace(/\D/g, ''),
      },
    };

    // Envolvemos a chamada no Retry Automático
    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/payments/deposit', payload, { headers: this.getHeaders() });
      return resp.data;
    });
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    const amount = Number(input.amount);
    
    // Gera a URL correta
    const callbackUrl = this.getCallbackUrl(input.clientCallbackUrl);

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description,
      clientCallbackUrl: callbackUrl, // Envia a URL calculada
    };

    return this.withAuthRetry(async () => {
      const resp = await this.http.post('/api/withdrawals/withdraw', payload, { headers: this.getHeaders() });
      return resp.data;
    });
  }
}