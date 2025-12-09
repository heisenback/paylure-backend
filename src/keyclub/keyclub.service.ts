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
  pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP' | 'RANDOM';
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
    // Remove barra no final da URL para evitar duplicidade
    const baseUrl = this.configService.get<string>('KEY_CLUB_API_URL') || 'https://api.the-key.club';
    this.apiUrl = baseUrl.replace(/\/$/, '');
    
    this.clientId = this.configService.get<string>('KEY_CLUB_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('KEY_CLUB_CLIENT_SECRET') || '';
    this.publicUrl = this.configService.get<string>('BASE_URL') || 'https://api.paylure.com.br';

    this.logger.log('🔧 KeyClub Service Inicializado');
    this.logger.log(`📡 API URL: ${this.apiUrl}`);
  }

  // ... (Lógica de Login e Token permanece igual) ...
  private decodeToken(token: string): { exp: number } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      return JSON.parse(payload);
    } catch (error) { return null; }
  }

  private isTokenExpiringSoon(): boolean {
    if (!this.cachedToken || !this.tokenExpiration) return true;
    const now = Math.floor(Date.now() / 1000);
    return (this.tokenExpiration - now) < 300;
  }

  private async login(): Promise<string> {
    try {
      this.logger.log('🔐 [Login] Fazendo login na KeyClub...');
      const response = await axios.post<LoginResponse>(
        `${this.apiUrl}/api/auth/login`,
        { client_id: this.clientId, client_secret: this.clientSecret },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      const token = response.data.token;
      if (!token) throw new Error('Token não retornado');
      
      const decoded = this.decodeToken(token);
      if (decoded?.exp) this.tokenExpiration = decoded.exp;
      
      this.cachedToken = token;
      return token;
    } catch (error: any) {
      this.logger.error('❌ [Login] Falha:', error.message);
      throw new HttpException('Erro ao autenticar na KeyClub', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && !this.isTokenExpiringSoon()) return this.cachedToken;
    if (this.isRefreshing) return new Promise(resolve => this.refreshSubscribers.push(resolve));
    
    this.isRefreshing = true;
    try {
      const token = await this.login();
      this.refreshSubscribers.forEach(cb => cb(token));
      this.refreshSubscribers = [];
      return token;
    } finally { this.isRefreshing = false; }
  }

  private getCallbackUrl(): string {
    return `${this.publicUrl}/api/v1/webhooks/keyclub`;
  }

  /**
   * ✅ CRIA UM DEPÓSITO (Gera QR Code)
   */
  async createDeposit(data: CreateDepositRequest): Promise<CreateDepositResponse> {
    try {
      const token = await this.getToken();
      const endpoint = `${this.apiUrl}/api/payments/deposit`; 

      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        payer: {
          name: data.payerName,
          document: data.payerDocument,
          email: data.payerEmail,
          ...(data.payerPhone && { phone: data.payerPhone }),
        },
        clientCallbackUrl: this.getCallbackUrl(),
      };

      const response = await axios.post(endpoint, payload, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000,
      });

      return {
        transactionId: response.data.qrCodeResponse.transactionId,
        status: response.data.qrCodeResponse.status,
        qrcode: response.data.qrCodeResponse.qrcode,
        amount: response.data.qrCodeResponse.amount,
      };
    } catch (error: any) {
      if (error.response?.status === 401 && this.cachedToken) {
        this.cachedToken = null;
        return this.createDeposit(data);
      }
      const msg = error.response?.data?.message || error.message;
      throw new HttpException(`Erro ao criar depósito: ${msg}`, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * ✅ REALIZA UM SAQUE (Envia PIX) - CORRIGIDO CONFORME SUA DOCUMENTAÇÃO
   * Doc: POST /api/withdrawals/withdraw
   */
  async createWithdrawal(data: CreateWithdrawalRequest) {
    try {
      const token = await this.getToken();
      
      // 🔧 CORREÇÃO 1: Endpoint correto da documentação
      const endpoint = `${this.apiUrl}/api/withdrawals/withdraw`;

      // Ajuste de compatibilidade de tipos
      let keyType = data.pixKeyType;
      if (keyType === 'EVP') keyType = 'RANDOM';

      // 🔧 CORREÇÃO 2: Payload com os nomes exatos da doc (key_type, pix_key)
      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        pix_key: data.pixKey,      // Doc pede: pix_key
        key_type: keyType,         // Doc pede: key_type (NÃO pix_key_type)
        description: 'Saque Plataforma Paylure',
        clientCallbackUrl: this.getCallbackUrl(),
      };

      this.logger.log(`🚀 Enviando saque para: ${endpoint}`);
      this.logger.log(`📦 Payload: ${JSON.stringify(payload)}`);

      const response = await axios.post(endpoint, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      this.logger.log('✅ [KeyClub] Saque criado com sucesso!');
      
      // A doc diz que retorna { message, withdrawal: {...} }
      return response.data.withdrawal || response.data;

    } catch (error: any) {
      // Retry no 401 (Token expirado)
      if (error.response?.status === 401 && this.cachedToken) {
        this.logger.warn('⚠️ Token expirado, renovando...');
        this.cachedToken = null;
        this.tokenExpiration = 0;
        return this.createWithdrawal(data);
      }

      this.logger.error('❌ [CreateWithdrawal] Erro:', error.response?.data || error.message);

      const errorMsg = error.response?.data?.message || error.message || 'Erro desconhecido';
      throw new HttpException(
        `Erro ao processar pagamento: ${errorMsg}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}