// src/keyclub/keyclub.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface CreateDepositInput {
  amount: number;
  externalId: string;
  payer: {
    name: string;
    email: string;
    document: string;
    phone?: string;
  };
  clientCallbackUrl: string;
}

export interface CreateWithdrawalInput {
  amount: number;
  externalId: string;
  pix_key: string;
  key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  description: string;
  clientCallbackUrl: string;
}

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('KEY_CLUB_BASE_URL')!;
    this.clientId = this.configService.get<string>('KEY_CLUB_CLIENT_ID')!;
    this.clientSecret = this.configService.get<string>('KEY_CLUB_CLIENT_SECRET')!;

    // ✅ Cria instância Axios com headers que simulam navegador real
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Origin': 'https://app.the-key.club',
        'Referer': 'https://app.the-key.club/'
      }
    });
  }

  private async authenticate(): Promise<string> {
    const now = Date.now();
    
    // ✅ Reutiliza token válido
    if (this.accessToken && this.tokenExpiry > now) {
      return this.accessToken;
    }

    this.logger.log('[KeyclubService] 🔐 Autenticando...');

    try {
      const response = await this.axiosInstance.post('/api/auth/login', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = now + (expiresIn * 1000) - 60000; // Renova 1min antes

      this.logger.log('[KeyclubService] ✅ Autenticação bem-sucedida');
      return this.accessToken;
    } catch (error: any) {
      this.logger.error('[KeyclubService] ❌ Falha na autenticação', error.message);
      
      if (error.response?.status === 403) {
        const rayId = error.response?.headers['cf-ray'];
        this.logger.error('[KeyclubService] 🛡️ BLOQUEADO PELO CLOUDFLARE!');
        if (rayId) this.logger.error(`[KeyclubService] Ray ID: ${rayId}`);
        throw new InternalServerErrorException(
          'Serviço temporariamente indisponível. Tente novamente em alguns minutos.'
        );
      }
      
      throw new InternalServerErrorException('Falha na autenticação com KeyClub');
    }
  }

  async createDeposit(input: CreateDepositInput) {
    this.logger.log(`[KeyclubService] 💰 Criando depósito: R$ ${input.amount.toFixed(2)}`);

    try {
      const token = await this.authenticate();

      const response = await this.axiosInstance.post(
        '/api/payments/deposit',
        {
          amount: input.amount,
          external_id: input.externalId,
          clientCallbackUrl: input.clientCallbackUrl,
          payer: {
            name: input.payer.name,
            email: input.payer.email,
            document: input.payer.document, // ✅ Documento sem formatação
            phone: input.payer.phone || '',
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      this.logger.log('[KeyclubService] ✅ Depósito criado com sucesso');

      return {
        pixCode: response.data.qrCodeResponse.qrcode,
        transactionId: response.data.qrCodeResponse.transactionId,
        status: response.data.qrCodeResponse.status,
        amount: response.data.qrCodeResponse.amount,
      };
    } catch (error: any) {
      this.logger.error('[KeyclubService] ❌ Erro ao criar depósito', error.response?.data || error.message);

      if (error.response?.status === 403) {
        throw new InternalServerErrorException(
          'Serviço temporariamente indisponível. Tente novamente em alguns minutos.'
        );
      }

      const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido';
      throw new InternalServerErrorException(`Erro ao criar depósito: ${errorMessage}`);
    }
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    this.logger.log(`[KeyclubService] 💸 Criando saque: R$ ${input.amount.toFixed(2)}`);

    try {
      const token = await this.authenticate();

      const response = await this.axiosInstance.post(
        '/api/payments/withdrawal',
        {
          amount: input.amount,
          external_id: input.externalId,
          pix_key: input.pix_key,
          key_type: input.key_type,
          description: input.description,
          clientCallbackUrl: input.clientCallbackUrl,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      this.logger.log('[KeyclubService] ✅ Saque criado com sucesso');

      return {
        transactionId: response.data.transactionId || response.data.transaction_id,
        status: response.data.status,
      };
    } catch (error: any) {
      this.logger.error('[KeyclubService] ❌ Erro ao criar saque', error.response?.data || error.message);

      if (error.response?.status === 403) {
        throw new InternalServerErrorException(
          'Serviço temporariamente indisponível. Tente novamente em alguns minutos.'
        );
      }

      const errorMessage = error.response?.data?.message || error.message || 'Erro desconhecido';
      throw new InternalServerErrorException(`Erro ao criar saque: ${errorMessage}`);
    }
  }
}