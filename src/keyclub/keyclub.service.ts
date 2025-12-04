import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  
  // ✅ CORRIGIDO: Usa KEY_CLUB_API_URL com fallback para KEY_CLUB_BASE_URL
  private readonly apiUrl = process.env.KEY_CLUB_API_URL || process.env.KEY_CLUB_BASE_URL || 'https://api.the-key.club';
  private readonly apiKey = process.env.KEY_CLUB_API_KEY;

  constructor() {
    // ✅ Log de inicialização para debug
    this.logger.log(`🔧 [Init] KeyClub API URL: ${this.apiUrl}`);
    this.logger.log(`🔧 [Init] API Key configurada: ${this.apiKey ? 'Sim' : 'Não'}`);
    
    if (!this.apiKey) {
      this.logger.error('❌ [Init] KEY_CLUB_API_KEY não configurada no .env!');
    }
  }

  /**
   * 🔥 CRIAR DEPÓSITO NA PAYLURE (KeyClub)
   */
  async createDeposit(data: {
    amount: number;
    externalId: string;
    payerName: string;
    payerDocument: string;
    payerEmail: string;
  }) {
    try {
      const callbackUrl = this.getCallbackUrl();

      this.logger.log(`🔥 [CreateDeposit] Enviando para KeyClub:`);
      this.logger.log(`   💵 Valor: R$ ${data.amount.toFixed(2)}`);
      this.logger.log(`   🆔 ExternalId: ${data.externalId}`);
      this.logger.log(`   🔗 Callback: ${callbackUrl}`);
      this.logger.log(`   👤 Pagador: ${data.payerName} (${data.payerEmail})`);

      const payload = {
        amount: data.amount,
        external_id: data.externalId,
        payer: {
          name: data.payerName,
          document: data.payerDocument,
          email: data.payerEmail,
        },
        clientCallbackUrl: callbackUrl,
      };

      const response = await axios.post(
        `${this.apiUrl}/api/deposits/deposit`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`✅ [CreateDeposit] Resposta recebida da KeyClub:`);
      this.logger.log(`   📋 Status: ${response.status}`);
      this.logger.log(`   🔗 QR Code: ${response.data.deposit?.qr_code ? 'Gerado' : 'Não gerado'}`);

      return response.data;
    } catch (error) {
      this.logger.error(`❌ [CreateDeposit] Erro ao criar depósito na KeyClub:`);
      this.logger.error(`   📄 Mensagem: ${error.message}`);
      
      if (error.response) {
        this.logger.error(`   📊 Status HTTP: ${error.response.status}`);
        this.logger.error(`   📋 Dados: ${JSON.stringify(error.response.data)}`);
      }

      throw new BadRequestException(
        error.response?.data?.message || 'Failed to create deposit in KeyClub',
      );
    }
  }

  /**
   * 🔥 CRIAR SAQUE NA PAYLURE (KeyClub)
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
        },
      );

      this.logger.log(`✅ [CreateWithdrawal] Saque criado com sucesso`);
      this.logger.log(`   📋 Transaction ID: ${response.data.withdrawal?.transaction_id}`);

      return response.data;
    } catch (error) {
      this.logger.error(`❌ [CreateWithdrawal] Erro ao criar saque na KeyClub:`);
      this.logger.error(`   📄 Mensagem: ${error.message}`);
      
      if (error.response) {
        this.logger.error(`   📊 Status HTTP: ${error.response.status}`);
        this.logger.error(`   📋 Dados: ${JSON.stringify(error.response.data)}`);
      }

      throw new BadRequestException(
        error.response?.data?.message || 'Failed to create withdrawal in KeyClub',
      );
    }
  }

  /**
   * 🔧 OBTER URL DE CALLBACK (SEM /v1)
   */
  private getCallbackUrl(): string {
    const envUrl = process.env.KEY_CLUB_CALLBACK_URL;

    if (envUrl) {
      this.logger.log(`🔗 [CallbackUrl] Usando URL do .env: ${envUrl}`);
      return envUrl;
    }

    // ⚠️ Fallback - construir URL automaticamente
    const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'https://api.paylure.com.br';
    const cleanBase = baseUrl.replace(/\/+$/, ''); // Remove barras finais
    
    // ✅ CORRIGIDO: Retorna SEM /v1
    const fallbackUrl = `${cleanBase}/api/webhooks/keyclub`;
    
    this.logger.warn(`⚠️ [CallbackUrl] KEY_CLUB_CALLBACK_URL não definida no .env`);
    this.logger.warn(`   🔧 Usando fallback: ${fallbackUrl}`);
    
    return fallbackUrl;
  }
}