// src/keyclub/keyclub.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

interface CreateDepositRequest {
  amount: number;
  externalId: string;
  payerName: string;
  payerDocument: string;
  payerEmail: string;
  payerPhone?: string;
}

interface CreateDepositResponse {
  transactionId: string;
  status: string;
  qrcode: string;
  amount: number;
}

interface LoginResponse {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
}

interface CreateWithdrawalRequest {
  amount: number;
  externalId: string;
  pixKey: string;
  pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
}

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly publicUrl: string;
  
  private cachedToken: string | null = null;
  private tokenExpiration: number = 0;
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('KEY_CLUB_API_URL') || 'https://api.the-key.club';
    this.clientId = this.configService.get<string>('KEY_CLUB_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('KEY_CLUB_CLIENT_SECRET') || '';
    this.publicUrl = this.configService.get<string>('PUBLIC_URL') || 'https://api.paylure.com.br';

    this.logger.log('🔧 KeyClub Service Inicializado');
    this.logger.log(`📡 API URL: ${this.apiUrl}`);
    this.logger.log(`🔗 Callback URL: ${this.getCallbackUrl()}`);
  }

  /**
   * Decodifica JWT e extrai expiração
   */
  private decodeToken(token: string): { exp: number } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      return JSON.parse(payload);
    } catch (error) {
      this.logger.error('❌ Erro ao decodificar token', error);
      return null;
    }
  }

  /**
   * Verifica se o token está próximo de expirar (menos de 5 minutos)
   */
  private isTokenExpiringSoon(): boolean {
    if (!this.cachedToken || !this.tokenExpiration) return true;
    
    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = this.tokenExpiration - now;
    
    if (timeRemaining < 300) { // 5 minutos
      this.logger.warn(`⚠️ Token vai expirar em ${Math.floor(timeRemaining / 60)} minutos`);
      return true;
    }
    
    return false;
  }

  /**
   * Faz login na KeyClub e retorna o token
   */
  private async login(): Promise<string> {
    try {
      this.logger.log('🔐 [Login] Fazendo login na KeyClub...');
      
      const response = await axios.post<LoginResponse>(
        `${this.apiUrl}/api/auth/login`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );

      const token = response.data.token;
      
      if (!token) {
        throw new Error('Token não retornado pela API');
      }

      // Decodifica o token para extrair a expiração
      const decoded = this.decodeToken(token);
      if (decoded && decoded.exp) {
        this.tokenExpiration = decoded.exp;
        const expirationDate = new Date(decoded.exp * 1000).toLocaleString('pt-BR');
        this.logger.log(`✅ [Login] Login bem-sucedido!`);
        this.logger.log(`⏰ Token expira em: ${expirationDate}`);
        this.logger.log(`⏳ Tempo restante: ${Math.floor((decoded.exp - Date.now() / 1000) / 60)} minutos`);
      }

      this.cachedToken = token;
      return token;

    } catch (error: any) {
      this.logger.error('❌ [Login] Erro ao fazer login na KeyClub:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new HttpException(
        'Erro ao autenticar na KeyClub',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Obtém o token válido (renovando se necessário)
   */
  private async getToken(): Promise<string> {
    // Se o token está válido e não vai expirar logo, retorna ele
    if (this.cachedToken && !this.isTokenExpiringSoon()) {
      return this.cachedToken;
    }

    // Se já está renovando, aguarda
    if (this.isRefreshing) {
      return new Promise((resolve) => {
        this.refreshSubscribers.push(resolve);
      });
    }

    // Inicia renovação
    this.isRefreshing = true;
    
    try {
      const token = await this.login();
      
      // Notifica todos que estavam aguardando
      this.refreshSubscribers.forEach(callback => callback(token));
      this.refreshSubscribers = [];
      
      return token;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Retorna a URL do callback
   */
  private getCallbackUrl(): string {
    return `${this.publicUrl}/api/v1/webhooks/keyclub`;
  }

  /**
   * 🔥 CRIA UM DEPÓSITO PIX NA KEYCLUB
   * 
   * ⚠️ IMPORTANTE: Este método DEVE receber os dados do LEAD/CLIENTE,
   * NÃO os dados do merchant/dono da conta KeyClub!
   * 
   * @param data Dados do depósito (amount, payerName, etc.)
   * @returns Dados do QR Code PIX gerado
   */
  async createDeposit(data: CreateDepositRequest): Promise<CreateDepositResponse> {
    try {
      const callbackUrl = this.getCallbackUrl();
      
      this.logger.log('🔥 [CreateDeposit] Enviando para KeyClub:');
      this.logger.log(`   💵 Valor: R$ ${data.amount.toFixed(2)}`);
      this.logger.log(`   🆔 ExternalId: ${data.externalId}`);
      this.logger.log(`   🔗 Callback: ${callbackUrl}`);
      this.logger.log(`   👤 Pagador (LEAD): ${data.payerName} (${data.payerEmail})`);
      this.logger.log(`   📄 CPF/CNPJ: ${data.payerDocument}`);

      // ⚠️ ATENÇÃO: Validação dos dados do LEAD
      if (!data.payerName || data.payerName.trim() === '') {
        throw new Error('Nome do pagador (Lead) é obrigatório');
      }
      if (!data.payerEmail || !data.payerEmail.includes('@')) {
        throw new Error('Email do pagador (Lead) é obrigatório e deve ser válido');
      }
      if (!data.payerDocument || data.payerDocument.length < 11) {
        throw new Error('CPF/CNPJ do pagador (Lead) é obrigatório');
      }

      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        payer: {
          name: data.payerName,        // ✅ Nome do LEAD
          document: data.payerDocument, // ✅ CPF do LEAD
          email: data.payerEmail,       // ✅ Email do LEAD
          ...(data.payerPhone && { phone: data.payerPhone }),
        },
        clientCallbackUrl: callbackUrl,
      };

      this.logger.debug('📦 Payload completo:', JSON.stringify(payload, null, 2));

      // Obtém token válido
      const token = await this.getToken();

      // 🔥 ENDPOINT CORRETO: /api/payments/deposit (NÃO /api/deposits/deposit!)
      const endpoint = `${this.apiUrl}/api/payments/deposit`;
      this.logger.log(`📡 Endpoint: ${endpoint}`);

      const response = await axios.post(
        endpoint,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 segundos
        }
      );

      this.logger.log('✅ [CreateDeposit] Depósito criado com sucesso!');
      this.logger.log(`   🆔 Transaction ID: ${response.data.qrCodeResponse?.transactionId}`);
      this.logger.log(`   📱 QR Code gerado: ${response.data.qrCodeResponse?.qrcode?.substring(0, 50)}...`);

      return {
        transactionId: response.data.qrCodeResponse.transactionId,
        status: response.data.qrCodeResponse.status,
        qrcode: response.data.qrCodeResponse.qrcode,
        amount: response.data.qrCodeResponse.amount,
      };

    } catch (error: any) {
      // Se recebeu 401, tenta renovar o token e tentar novamente (uma vez apenas)
      if (error.response?.status === 401 && this.cachedToken) {
        this.logger.warn('⚠️ Recebeu 401, renovando token e tentando novamente...');
        this.cachedToken = null; // Invalida o token
        this.tokenExpiration = 0;
        
        // Tenta novamente (recursão controlada - apenas 1 vez)
        return this.createDepositWithRetry(data);
      }

      this.logger.error('❌ [CreateDeposit] Erro ao criar depósito na KeyClub:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        endpoint: `${this.apiUrl}/api/payments/deposit`,
      });

      // Retorna mensagem de erro detalhada
      const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido';
      throw new HttpException(
        `Erro ao criar depósito: ${errorMessage}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Tenta criar depósito novamente após renovar o token (apenas 1 tentativa)
   */
  private async createDepositWithRetry(data: CreateDepositRequest): Promise<CreateDepositResponse> {
    try {
      const token = await this.getToken();
      const endpoint = `${this.apiUrl}/api/payments/deposit`;
      const callbackUrl = this.getCallbackUrl();

      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        payer: {
          name: data.payerName,
          document: data.payerDocument,
          email: data.payerEmail,
          ...(data.payerPhone && { phone: data.payerPhone }),
        },
        clientCallbackUrl: callbackUrl,
      };

      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      this.logger.log('✅ [CreateDeposit] Depósito criado com sucesso na segunda tentativa!');

      return {
        transactionId: response.data.qrCodeResponse.transactionId,
        status: response.data.qrCodeResponse.status,
        qrcode: response.data.qrCodeResponse.qrcode,
        amount: response.data.qrCodeResponse.amount,
      };

    } catch (error: any) {
      this.logger.error('❌ [CreateDeposit] Erro na segunda tentativa:', error.response?.data);
      throw error;
    }
  }

  /**
   * 🔥 CRIA UM SAQUE PIX NA KEYCLUB
   */
  async createWithdrawal(data: CreateWithdrawalRequest) {
    try {
      const token = await this.getToken();
      const callbackUrl = this.getCallbackUrl();

      this.logger.log('🔥 [CreateWithdrawal] Enviando para KeyClub:');
      this.logger.log(`   💵 Valor: R$ ${data.amount.toFixed(2)}`);
      this.logger.log(`   🆔 ExternalId: ${data.externalId}`);
      this.logger.log(`   🔗 Callback: ${callbackUrl}`);
      this.logger.log(`   🔑 Chave PIX: ${data.pixKey} (Tipo: ${data.pixKeyType})`);

      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        pix_key: data.pixKey,
        pix_key_type: data.pixKeyType,
        clientCallbackUrl: callbackUrl,
      };

      const endpoint = `${this.apiUrl}/api/payments/withdraw`;
      this.logger.log(`📡 Endpoint: ${endpoint}`);

      const response = await axios.post(
        endpoint,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      this.logger.log('✅ [CreateWithdrawal] Saque criado com sucesso!');
      this.logger.log(`   🆔 Transaction ID: ${response.data.transactionId}`);

      return response.data;

    } catch (error: any) {
      if (error.response?.status === 401 && this.cachedToken) {
        this.logger.warn('⚠️ Recebeu 401, renovando token e tentando novamente...');
        this.cachedToken = null;
        this.tokenExpiration = 0;
        return this.createWithdrawal(data);
      }

      this.logger.error('❌ [CreateWithdrawal] Erro ao criar saque na KeyClub:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido';
      throw new HttpException(
        `Erro ao criar saque: ${errorMessage}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Consulta o status de uma transação
   */
  async checkTransactionStatus(transactionId: string) {
    try {
      const token = await this.getToken();

      this.logger.log(`🔍 [CheckStatus] Consultando status da transação: ${transactionId}`);

      const response = await axios.get(
        `${this.apiUrl}/api/payments/status/${transactionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      this.logger.log(`✅ [CheckStatus] Status: ${response.data.status}`);
      return response.data;

    } catch (error: any) {
      if (error.response?.status === 401 && this.cachedToken) {
        this.logger.warn('⚠️ Recebeu 401, renovando token e tentando novamente...');
        this.cachedToken = null;
        this.tokenExpiration = 0;
        return this.checkTransactionStatus(transactionId);
      }

      this.logger.error('❌ [CheckStatus] Erro ao consultar status:', error.message);
      throw new HttpException(
        error.response?.data?.message || 'Erro ao consultar status',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Processa webhook da KeyClub (atualização de status de depósito)
   */
  async handleWebhook(payload: any): Promise<void> {
    try {
      this.logger.log('📩 [Webhook] Recebido da KeyClub:', JSON.stringify(payload, null, 2));

      const { transaction_id, status, amount, type } = payload;

      if (!transaction_id || !status) {
        throw new Error('Webhook inválido: transaction_id ou status ausente');
      }

      this.logger.log(`🔄 [Webhook] Status atualizado: ${transaction_id} -> ${status}`);

      // TODO: Atualizar o status do depósito no banco de dados
      // Exemplo: await this.depositsService.updateStatus(transaction_id, status);

    } catch (error: any) {
      this.logger.error('❌ [Webhook] Erro ao processar webhook:', error.message);
      throw error;
    }
  }
}