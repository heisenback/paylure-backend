// src/xflow/xflow.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class XflowService {
  private readonly logger = new Logger(XflowService.name);
  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  private cachedToken: string | null = null;
  private tokenExpiration: number = 0;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = this.config.get<string>('XFLOW_API_URL') || 'https://api.xflowpayments.co';
    this.clientId = this.config.get<string>('XFLOW_CLIENT_ID');
    this.clientSecret = this.config.get<string>('XFLOW_CLIENT_SECRET');
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiration) {
      return this.cachedToken;
    }

    try {
      this.logger.log('🔐 Solicitando novo token XFlow...');
      const response = await axios.post(`${this.apiUrl}/api/auth/login`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      this.cachedToken = response.data.token;
      this.tokenExpiration = now + 50 * 60 * 1000; // 50 min
      return this.cachedToken;
    } catch (e: any) {
      this.logger.error(`❌ Erro login XFlow: ${e.response?.data?.message || e.message}`);
      throw new HttpException('Falha na autenticação com a adquirente', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDeposit(data: { amount: number; externalId: string; payerName: string; payerEmail: string; payerDocument: string }) {
    const token = await this.getToken();
    try {
      const payload = {
        amount: data.amount, // Valor em Reais (ex: 10.50)
        external_id: data.externalId,
        clientCallbackUrl: `${this.config.get('BASE_URL')}/api/v1/webhooks/xflow`,
        payer: {
          name: data.payerName,
          email: data.payerEmail,
          document: data.payerDocument.replace(/\D/g, ''),
        },
      };

      const response = await axios.post(`${this.apiUrl}/api/payments/deposit`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return {
        transactionId: response.data.transaction_id,
        qrcode: response.data.pix_code || response.data.qrcode,
        status: 'PENDING'
      };
    } catch (e: any) {
      this.logger.error(`❌ Erro Depósito XFlow: ${e.response?.data?.message || e.message}`);
      throw new HttpException('Erro ao gerar PIX na XFlow', HttpStatus.BAD_REQUEST);
    }
  }

  async createWithdrawal(data: { amount: number; externalId: string; pixKey: string; pixKeyType: string; description?: string }) {
    const token = await this.getToken();
    try {
      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        pix_key: data.pixKey,
        key_type: data.pixKeyType,
        description: data.description || 'Saque Paylure',
        clientCallbackUrl: `${this.config.get('BASE_URL')}/api/v1/webhooks/xflow`,
      };

      const response = await axios.post(`${this.apiUrl}/api/withdrawals/withdraw`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.data;
    } catch (e: any) {
      this.logger.error(`❌ Erro Saque XFlow: ${e.response?.data?.message || e.message}`);
      throw new HttpException('Erro ao processar saque na XFlow', HttpStatus.BAD_REQUEST);
    }
  }
}