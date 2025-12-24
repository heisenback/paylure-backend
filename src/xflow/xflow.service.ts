// src/xflow/xflow.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';

interface XflowLoginResponse {
  token: string;
}

export interface CreateXflowDepositRequest {
  amount: number; // em BRL
  externalId: string;
  payerName: string;
  payerDocument: string;
  payerEmail: string;
}

export interface CreateXflowDepositResponse {
  transactionId: string;
  status: string;
  qrcode: string;
  amount: number;
}

export interface CreateXflowWithdrawalRequest {
  amount: number; // em BRL
  externalId: string;
  pixKey: string;
  pixKeyType: 'EMAIL' | 'CPF' | 'CNPJ' | 'PHONE';
  description?: string;
  clientCallbackUrl?: string;
}

@Injectable()
export class XflowService {
  private readonly logger = new Logger(XflowService.name);

  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly publicUrl: string;

  private cachedToken: string | null = null;
  private tokenExpiration: number = 0;

  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];

  constructor(private readonly configService: ConfigService) {
    const baseUrl =
      this.configService.get<string>('XFLOW_API_URL') || 'https://api.xflowpayments.co';

    this.apiUrl = baseUrl.replace(/\/$/, '');

    this.clientId = this.configService.get<string>('XFLOW_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('XFLOW_CLIENT_SECRET') || '';

    // Segue o mesmo padrão do seu KeyclubService (pra não quebrar sua infra de prefixo)
    this.publicUrl = this.configService.get<string>('BASE_URL') || 'https://api.paylure.com.br';

    this.logger.log('🔧 Xflow Service Inicializado');
    this.logger.log(`📡 API URL: ${this.apiUrl}`);
  }

  private decodeJwtExp(token: string): { exp: number } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  private isTokenExpiringSoon(): boolean {
    if (!this.cachedToken || !this.tokenExpiration) return true;
    const now = Math.floor(Date.now() / 1000);
    return this.tokenExpiration - now < 300; // 5 min
  }

  private async login(): Promise<string> {
    try {
      if (!this.clientId || !this.clientSecret) {
        throw new Error('XFLOW_CLIENT_ID / XFLOW_CLIENT_SECRET não configurados');
      }

      const response = await axios.post<XflowLoginResponse>(
        `${this.apiUrl}/api/auth/login`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        },
      );

      const token = response.data?.token;
      if (!token) throw new Error('Token não retornado pela Xflow');

      const decoded = this.decodeJwtExp(token);
      if (decoded?.exp) this.tokenExpiration = decoded.exp;

      this.cachedToken = token;
      return token;
    } catch (err) {
      const e = err as AxiosError<any>;
      const msg = e.response?.data?.message || e.message || 'Erro desconhecido';
      this.logger.error(`❌ [Xflow Login] Falha: ${msg}`);
      throw new HttpException('Erro ao autenticar na XflowPayments', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && !this.isTokenExpiringSoon()) return this.cachedToken;

    if (this.isRefreshing) {
      return new Promise((resolve) => this.refreshSubscribers.push(resolve));
    }

    this.isRefreshing = true;
    try {
      const token = await this.login();
      this.refreshSubscribers.forEach((cb) => cb(token));
      this.refreshSubscribers = [];
      return token;
    } finally {
      this.isRefreshing = false;
    }
  }

  private getCallbackUrl(): string {
    // segue o seu padrão atual (Keyclub usa /api/v1/webhooks/...)
    return `${this.publicUrl}/api/v1/webhooks/xflow`;
  }

  // Extrator defensivo (porque a doc não mostrou o shape exato da resposta)
  private extractDepositResponse(data: any): CreateXflowDepositResponse {
    const root = data?.qrCodeResponse || data?.data || data;

    const transactionId =
      root?.transactionId ||
      root?.transaction_id ||
      root?.id ||
      data?.transactionId ||
      data?.transaction_id ||
      data?.id;

    const status = String(
      root?.status || data?.status || root?.payment_status || data?.payment_status || 'PENDING',
    ).toUpperCase();

    const qrcode =
      root?.qrcode ||
      root?.qrCode ||
      root?.qr_code ||
      root?.pix_qrcode ||
      data?.qrcode ||
      data?.qrCode ||
      data?.qr_code;

    const amount = Number(root?.amount ?? data?.amount ?? NaN);

    if (!transactionId || !qrcode) {
      this.logger.error(`❌ Resposta inesperada da Xflow (deposit): ${JSON.stringify(data)}`);
      throw new HttpException(
        'A Xflow retornou uma resposta inesperada ao criar o depósito.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      transactionId: String(transactionId),
      status,
      qrcode: String(qrcode),
      amount: Number.isFinite(amount) ? amount : 0,
    };
  }

  async createDeposit(input: CreateXflowDepositRequest): Promise<CreateXflowDepositResponse> {
    try {
      const token = await this.getToken();

      const payload = {
        amount: input.amount,
        external_id: input.externalId,
        clientCallbackUrl: this.getCallbackUrl(),
        payer: {
          name: input.payerName,
          email: input.payerEmail,
          document: input.payerDocument,
        },
      };

      const response = await axios.post(`${this.apiUrl}/api/payments/deposit`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      return this.extractDepositResponse(response.data);
    } catch (err) {
      const e = err as AxiosError<any>;

      // Se token deu ruim, força refresh 1x
      if (e.response?.status === 401 && this.cachedToken) {
        this.cachedToken = null;
        this.tokenExpiration = 0;
        return this.createDeposit(input);
      }

      const msg = e.response?.data?.message || e.message || 'Erro desconhecido';
      throw new HttpException(`Erro ao criar depósito (Xflow): ${msg}`, HttpStatus.BAD_REQUEST);
    }
  }

  async createWithdrawal(input: CreateXflowWithdrawalRequest) {
    try {
      const token = await this.getToken();

      const payload = {
        amount: input.amount,
        external_id: input.externalId,
        pix_key: input.pixKey,
        key_type: input.pixKeyType,
        description: input.description || 'Saque Plataforma Paylure',
        clientCallbackUrl: input.clientCallbackUrl || this.getCallbackUrl(),
      };

      const response = await axios.post(`${this.apiUrl}/api/withdrawals/withdraw`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      return response.data;
    } catch (err) {
      const e = err as AxiosError<any>;

      if (e.response?.status === 401 && this.cachedToken) {
        this.cachedToken = null;
        this.tokenExpiration = 0;
        return this.createWithdrawal(input);
      }

      const msg = e.response?.data?.message || e.message || 'Erro desconhecido';
      throw new HttpException(`Erro ao criar saque (Xflow): ${msg}`, e.response?.status || 500);
    }
  }
}
