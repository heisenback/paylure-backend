// src/keyclub/keyclub.service.ts
import axios, { AxiosError } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

type CreateDepositInput = {
  amount: number; // EM REAIS (ex.: 10.00)
  externalId?: string;
  clientCallbackUrl?: string;
  payer: {
    name: string;
    email: string;
    document: string; // CPF/CNPJ
  };
};

// 🚨 CORREÇÃO TS2459: Adicionado 'export' ao tipo CreateWithdrawalInput
export type CreateWithdrawalInput = {
    amount: number; // EM REAIS
    externalId: string;
    pix_key: string;
    key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
    description?: string;
    clientCallbackUrl: string;
}

@Injectable()
export class KeyclubService {
// ... (O restante do arquivo é mantido sem alterações. Os métodos createDeposit e createWithdrawal estão corretos)
  private readonly logger = new Logger(KeyclubService.name);
  // Garante que a URL base não tenha barra no final
  private readonly baseUrl =
    process.env.KEY_CLUB_BASE_URL?.replace(/\/+$/, '') || 'https://api.the-key.club';
  private token: string | null = null;

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Autenticação KeyClub: POST /api/auth/login
   */
  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      throw new Error(
        'Credenciais da KeyClub ausentes. Configure KEY_CLUB_CLIENT_ID e KEY_CLUB_CLIENT_SECRET no .env.',
      );
    }

    // 1) Tentativa ÚNICA: POST /api/auth/login
    try {
      this.logger.log('[KeyclubService] Autenticando: tentando /api/auth/login…');
      // Rota CORRETA de autenticação da KeyClub 
      const url = `${this.baseUrl}/api/auth/login`; 
      const { data } = await axios.post(
        url,
        {
          client_id: clientId, // Parâmetro conforme documentação 
          client_secret: clientSecret, // Parâmetro conforme documentação 
        },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } },
      );
      
      const accessToken = data?.token; // O token na resposta da KeyClub se chama 'token' 
      if (!accessToken) throw new Error('Resposta sem token.');
      
      this.token = accessToken as string;
      this.logger.log('[KeyclubService] Token obtido via /api/auth/login.');
      return this.token;
      
    } catch (e) {
      const ax = e as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] /api/auth/login falhou: status=${ax.response.status} data=${JSON.stringify(
            ax.response.data,
          )}`,
        );
        throw new Error(ax.response.data?.message || 'Falha na autenticação da KeyClub.');
      }
      this.logger.error(`[KeyclubService] Erro de rede na autenticação: ${ax.message}`);
      throw new Error('Falha de rede ao comunicar com KeyClub para autenticação.');
    }
  }

  // MÉTODO 1: Cria Depósito (Mantido do código anterior)
  async createDeposit(input: CreateDepositInput) {
    await this.ensureToken();

    // Validações locais (continuam as mesmas)
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1.0) { // Alterado para R$ 1,00
      throw new Error('Valor mínimo para depósito é R$ 1,00.');
    }

    const callback =
      input.clientCallbackUrl ||
      process.env.KEY_CLUB_CALLBACK_URL ||
      (process.env.BASE_URL
        ? `${process.env.BASE_URL.replace(/\/+$/, '')}/api/keyclub/callback`
        : '');

    if (!callback || /localhost|127\.0\.0\.1/i.test(callback)) {
      throw new Error('Callback URL inválida. Configure KEY_CLUB_CALLBACK_URL com uma URL pública HTTPS.');
    }

    const doc = input.payer?.document?.toString().replace(/\D/g, '');
    if (!doc || doc.length < 11) {
      throw new Error('Documento do pagador ausente ou inválido (CPF/CNPJ).');
    }

    const payload = {
      amount: Number(amount.toFixed(2)), // EM REAIS
      external_id: input.externalId || uuidv4(),
      clientCallbackUrl: callback,
      payer: {
        name: input.payer.name,
        email: input.payer.email,
        document: doc,
      },
    };

    try {
      this.logger.log(
        `[KeyclubService] Criando depósito: external_id=${payload.external_id}, amount=${payload.amount}`,
      );
      // Rota de depósito: /api/payments/deposit
      const url = `${this.baseUrl}/api/payments/deposit`;
      const { data, status } = await axios.post(url, payload, { headers: this.authHeaders() });

      if (status !== 201) { // A documentação espera 201 Created para sucesso
        this.logger.error(`[KeyclubService] Status inesperado: ${status} body=${JSON.stringify(data)}`);
        throw new Error(data?.message || 'Falha na criação do depósito no KeyClub.');
      }

      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] Erro na criação de depósito: status=${ax.response.status} body=${JSON.stringify(
            ax.response.data,
          )}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      this.logger.error(`[KeyclubService] Erro de rede/axios: ${ax.message}`);
      throw new Error('Falha ao comunicar com KeyClub');
    }
  }
  
  // MÉTODO 2: Cria Saque (NOVO)
  async createWithdrawal(input: CreateWithdrawalInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    // Validação de mínimo de R$ 1,00 (em REAIS, pois a API externa espera em REAIS)
    if (!Number.isFinite(amount) || amount < 1.0) { 
      throw new Error('Valor mínimo para saque é R$ 1,00.');
    }
    
    if (!this.baseUrl) {
      throw new Error('KEY_CLUB_BASE_URL não configurada.');
    }

    const payload = {
        amount: Number(amount.toFixed(2)), // EM REAIS
        external_id: input.externalId,
        pix_key: input.pix_key,
        key_type: input.key_type,
        description: input.description,
        clientCallbackUrl: input.clientCallbackUrl,
    };

    try {
      this.logger.log(
        `[KeyclubService] Solicitando saque: external_id=${payload.external_id}, amount=${payload.amount}`,
      );
      // Rota de saque conforme documentação: /api/withdrawals/withdraw 
      const url = `${this.baseUrl}/api/withdrawals/withdraw`; 
      const { data, status } = await axios.post(url, payload, { headers: this.authHeaders() });

      if (status !== 200) { // A documentação espera 200 OK para saque 
        this.logger.error(`[KeyclubService] Status inesperado: ${status} body=${JSON.stringify(data)}`);
        throw new Error(data?.message || 'Falha na solicitação de saque no KeyClub.');
      }

      return data;
    } catch (error) {
        const ax = error as AxiosError<any>;
        if (ax.response) {
            this.logger.error(
              `[KeyclubService] Erro na solicitação de saque: status=${ax.response.status} body=${JSON.stringify(
                ax.response.data,
              )}`,
            );
            throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
        }
        throw new Error('Falha ao comunicar com KeyClub para saque.');
    }
  }
}