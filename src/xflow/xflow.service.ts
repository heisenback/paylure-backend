import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class XflowService {
  private readonly logger = new Logger(XflowService.name);
  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;

  private cachedToken: string | null = null;
  private tokenExpiration: number = 0;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = this.config.get<string>('XFLOW_API_URL') || 'https://api.xflowpayments.co';
    this.clientId = this.config.get<string>('XFLOW_CLIENT_ID') || '';
    this.clientSecret = this.config.get<string>('XFLOW_CLIENT_SECRET') || '';
    this.baseUrl = this.config.get<string>('BASE_URL') || 'https://api.paylure.com.br';
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiration - 300000) {
      return this.cachedToken!;
    }

    try {
      const response = await axios.post(`${this.apiUrl}/api/auth/login`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      if (!response.data?.token) throw new Error('Token não retornado');
      
      this.cachedToken = response.data.token;
      this.tokenExpiration = now + (50 * 60 * 1000); 
      return this.cachedToken!;
    } catch (error: any) {
      this.logger.error('❌ Erro auth XFlow:', error.message);
      throw new HttpException('Falha na autenticação da adquirente', HttpStatus.BAD_GATEWAY);
    }
  }

  async createDeposit(data: {
    amount: number;
    externalId: string;
    payerName: string;
    payerEmail: string;
    payerDocument: string;
  }) {
    const token = await this.getToken();
    // Passamos o externalId na URL para garantir rastreio, mas vamos salvar o ID da XFlow também
    const webhookUrl = `${this.baseUrl}/api/v1/webhooks/xflow?eid=${data.externalId}`;
    
    const documentClean = data.payerDocument.replace(/\D/g, '');

    const payload = {
      amount: data.amount,
      external_id: data.externalId,
      clientCallbackUrl: webhookUrl,
      payer: {
        name: data.payerName,
        email: data.payerEmail,
        document: documentClean,
      },
    };

    try {
      this.logger.log(`📤 Enviando payload XFlow: ${JSON.stringify(payload)}`);

      const response = await axios.post(`${this.apiUrl}/api/payments/deposit`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      this.logger.log(`📥 Resposta XFlow: ${JSON.stringify(response.data)}`);

      // 🔥 CORREÇÃO: Verifica se a resposta veio aninhada em 'qrCodeResponse'
      const responseData = response.data.qrCodeResponse || response.data;

      // Busca o QR Code em todos os campos possíveis
      const qrCode = 
        responseData.qrcode || 
        responseData.pix_code || 
        responseData.emv || 
        responseData.payload ||
        responseData.qr_code;

      // Busca o ID da Transação da XFlow (Importante para o Webhook!)
      const xflowId = responseData.transactionId || responseData.transaction_id;

      if (!qrCode) {
        this.logger.error('⚠️ QR Code não encontrado na resposta da XFlow!');
      }

      return {
        transactionId: xflowId || data.externalId, // Retorna o ID da XFlow se existir
        qrcode: qrCode,
        status: 'PENDING'
      };
    } catch (error: any) {
      this.logger.error('❌ Erro CreateDeposit XFlow:', error.response?.data || error.message);
      throw new HttpException('Erro ao gerar PIX', HttpStatus.BAD_REQUEST);
    }
  }

  async createWithdrawal(data: {
    amount: number;
    externalId: string;
    pixKey: string;
    pixKeyType: string;
    description?: string;
  }) {
    const token = await this.getToken();
    const webhookUrl = `${this.baseUrl}/api/v1/webhooks/xflow?eid=${data.externalId}`;

    const payload = {
      amount: data.amount,
      external_id: data.externalId,
      pix_key: data.pixKey,
      key_type: data.pixKeyType,
      description: data.description || 'Saque Plataforma',
      clientCallbackUrl: webhookUrl,
    };

    try {
      const response = await axios.post(`${this.apiUrl}/api/withdrawals/withdraw`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error('❌ Erro CreateWithdrawal XFlow:', error.response?.data || error.message);
      const msg = error.response?.data?.message || 'Erro ao processar saque';
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }
}