// src/keyclub/keyclub.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  
  private readonly apiUrl = process.env.KEY_CLUB_API_URL || process.env.KEY_CLUB_BASE_URL || 'https://api.the-key.club';
  private readonly apiKey = process.env.KEY_CLUB_API_KEY;

  constructor() {
    this.logger.log(`🔧 [Init] KeyClub API URL: ${this.apiUrl}`);
    this.logger.log(`🔧 [Init] API Key configurada: ${this.apiKey ? 'Sim ✅' : 'Não ❌'}`);
    
    if (!this.apiKey) {
      this.logger.error('❌ [Init] KEY_CLUB_API_KEY não configurada no .env!');
    }
  }

  /**
   * 🔥 CRIAR DEPÓSITO NA KEYCLUB (FORMATO CORRETO)
   */
  async createDeposit(data: {
    amount: number; // EM REAIS (ex: 10.00)
    external_id: string;
    clientCallbackUrl: string;
    payer: {
      name: string;
      email: string;
      document: string;
      phone?: string;
    };
  }) {
    try {
      this.logger.log(`🔥 [CreateDeposit] ==========================================`);
      this.logger.log(`📤 Payload enviado para KeyClub:`);
      this.logger.log(JSON.stringify(data, null, 2));

      // ✅ URL CORRIGIDA: /api/payments/deposit (conforme documentação)
      const endpoint = `${this.apiUrl}/api/payments/deposit`;
      
      this.logger.log(`🎯 Endpoint: ${endpoint}`);
      this.logger.log(`🔑 API Key: ${this.apiKey?.substring(0, 20)}...`);

      const response = await axios.post(endpoint, data, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 segundos
        validateStatus: (status) => status < 600, // Aceita qualquer status para logar
      });

      this.logger.log(`✅ [CreateDeposit] Resposta recebida da KeyClub:`);
      this.logger.log(`📊 Status HTTP: ${response.status}`);
      this.logger.log(`📦 Response Data:`);
      this.logger.log(JSON.stringify(response.data, null, 2));

      // ✅ VERIFICA SE A RESPOSTA FOI BEM-SUCEDIDA
      if (response.status !== 200 && response.status !== 201) {
        this.logger.error(`❌ Erro HTTP ${response.status}`);
        throw new Error(`KeyClub retornou status ${response.status}: ${JSON.stringify(response.data)}`);
      }

      // ✅ EXTRAÇÃO CORRETA DA RESPOSTA
      // Segundo a documentação, a resposta vem assim:
      // {
      //   "message": "Deposit created successfully.",
      //   "qrCodeResponse": {
      //     "transactionId": "abc123",
      //     "status": "PENDING",
      //     "qrcode": "00020126...",
      //     "amount": 100.50
      //   }
      // }

      const qrData = response.data.qrCodeResponse || response.data;
      
      if (!qrData.transactionId) {
        this.logger.error('❌ transactionId não encontrado na resposta!');
        this.logger.error('Resposta completa:', JSON.stringify(response.data, null, 2));
        throw new Error('KeyClub não retornou transactionId');
      }

      if (!qrData.qrcode) {
        this.logger.error('❌ QR Code não encontrado na resposta!');
        this.logger.error('Resposta completa:', JSON.stringify(response.data, null, 2));
        throw new Error('KeyClub não retornou QR Code');
      }

      this.logger.log(`✅ Depósito criado com sucesso!`);
      this.logger.log(`🆔 Transaction ID: ${qrData.transactionId}`);
      this.logger.log(`💰 Valor: R$ ${qrData.amount}`);
      this.logger.log(`📱 QR Code: ${qrData.qrcode.substring(0, 50)}...`);

      return response.data;
      
    } catch (error) {
      const axiosError = error as AxiosError;
      
      this.logger.error(`❌ [CreateDeposit] ERRO COMPLETO:`);
      this.logger.error(`📋 Mensagem: ${axiosError.message}`);
      
      if (axiosError.response) {
        this.logger.error(`📊 Status HTTP: ${axiosError.response.status}`);
        this.logger.error(`📦 Response Data:`);
        this.logger.error(JSON.stringify(axiosError.response.data, null, 2));
        this.logger.error(`📋 Headers:`);
        this.logger.error(JSON.stringify(axiosError.response.headers, null, 2));
      } else if (axiosError.request) {
        this.logger.error(`📡 Sem resposta do servidor`);
        this.logger.error(`Request config:`, JSON.stringify(axiosError.config, null, 2));
      } else {
        this.logger.error(`⚠️ Erro ao configurar request:`, axiosError.message);
      }

      // Lança erro com mensagem clara
      const errorMessage = (axiosError.response?.data as any)?.message 
        || (axiosError.response?.data as any)?.error
        || axiosError.message 
        || 'Erro ao criar depósito na KeyClub';

      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * 🔥 CRIAR SAQUE NA KEYCLUB
   */
  async createWithdrawal(data: {
    amount: number;
    externalId: string;
    pixKey: string;
    keyType: string;
    description?: string;
  }) {
    try {
      const callbackUrl = this.getCallbackUrl();

      this.logger.log(`🔥 [CreateWithdrawal] Enviando saque para KeyClub:`);
      this.logger.log(`   💵 Valor: R$ ${data.amount.toFixed(2)}`);
      this.logger.log(`   🆔 ExternalId: ${data.externalId}`);
      this.logger.log(`   🔑 Chave PIX: ${data.pixKey} (${data.keyType})`);
      this.logger.log(`   🔗 Callback: ${callbackUrl}`);

      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        pix_key: data.pixKey,
        key_type: data.keyType,
        description: data.description || 'Saque via plataforma',
        clientCallbackUrl: callbackUrl,
      };

      const response = await axios.post(
        `${this.apiUrl}/api/withdrawals/withdraw`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      this.logger.log(`✅ [CreateWithdrawal] Saque criado com sucesso`);
      this.logger.log(`   📋 Transaction ID: ${response.data.withdrawal?.transaction_id}`);

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      
      this.logger.error(`❌ [CreateWithdrawal] Erro ao criar saque na KeyClub:`);
      this.logger.error(`   📄 Mensagem: ${axiosError.message}`);
      
      if (axiosError.response) {
        this.logger.error(`   📊 Status HTTP: ${axiosError.response.status}`);
        this.logger.error(`   📋 Dados: ${JSON.stringify(axiosError.response.data)}`);
      }

      throw new BadRequestException(
        (axiosError.response?.data as any)?.message || 'Failed to create withdrawal in KeyClub',
      );
    }
  }

  /**
   * 🔧 OBTER URL DE CALLBACK
   */
  private getCallbackUrl(): string {
    const envUrl = process.env.KEY_CLUB_CALLBACK_URL;

    if (envUrl) {
      this.logger.log(`🔗 [CallbackUrl] Usando URL do .env: ${envUrl}`);
      return envUrl;
    }

    const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'https://api.paylure.com.br';
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const fallbackUrl = `${cleanBase}/api/webhooks/keyclub`;
    
    this.logger.warn(`⚠️ [CallbackUrl] KEY_CLUB_CALLBACK_URL não definida no .env`);
    this.logger.warn(`   🔧 Usando fallback: ${fallbackUrl}`);
    
    return fallbackUrl;
  }
}