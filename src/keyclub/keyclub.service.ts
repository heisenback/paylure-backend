// src/keyclub/keyclub.service.ts
import axios, { AxiosError } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as https from 'https';

type CreateDepositInput = {
  amount: number;
  externalId?: string;
  clientCallbackUrl?: string;
  payer: {
    name: string;
    email: string;
    document: string;
  };
};

export type CreateWithdrawalInput = {
  amount: number;
  externalId: string;
  pix_key: string;
  key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  description?: string;
  clientCallbackUrl: string;
};

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  private readonly baseUrl =
    process.env.KEY_CLUB_BASE_URL?.replace(/\/+$/, '') || 'https://api.the-key.club';
  private token: string | null = null;

  // Configuração do axios com bypass SSL
  private readonly axiosConfig = {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    timeout: 30000,
  };

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Paylure-Gateway/1.0',
    };
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const clientId = process.env.KEY_CLUB_CLIENT_ID?.trim();
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      this.logger.error('[KeyclubService] ❌ Credenciais ausentes no .env');
      throw new Error(
        'Credenciais da KeyClub ausentes. Configure KEY_CLUB_CLIENT_ID e KEY_CLUB_CLIENT_SECRET no .env.',
      );
    }

    try {
      this.logger.log(`[KeyclubService] 🔐 Tentando autenticar...`);
      this.logger.log(`[KeyclubService] URL: ${this.baseUrl}/api/auth/login`);
      this.logger.log(`[KeyclubService] Client ID: ${clientId.substring(0, 30)}...`);
      this.logger.log(`[KeyclubService] Client Secret (primeiros 20 chars): ${clientSecret.substring(0, 20)}...`);

      const url = `${this.baseUrl}/api/auth/login`;
      
      const payload = {
        client_id: clientId,
        client_secret: clientSecret,
      };

      this.logger.log(`[KeyclubService] Payload: ${JSON.stringify({ client_id: clientId, client_secret: clientSecret.substring(0, 20) + '...' })}`);

      const { data, status, headers } = await axios.post(
        url,
        payload,
        {
          ...this.axiosConfig,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Paylure-Gateway/1.0',
          },
        },
      );

      this.logger.log(`[KeyclubService] ✅ Resposta HTTP: status=${status}`);
      this.logger.log(`[KeyclubService] Response headers: ${JSON.stringify(headers)}`);
      this.logger.log(`[KeyclubService] Response data: ${JSON.stringify(data).substring(0, 200)}`);

      const accessToken = data?.token || data?.access_token || data?.accessToken;
      
      if (!accessToken) {
        this.logger.error(`[KeyclubService] ❌ Token não encontrado na resposta`);
        this.logger.error(`[KeyclubService] Resposta completa: ${JSON.stringify(data)}`);
        throw new Error('Resposta da API não contém token de acesso.');
      }

      this.token = accessToken as string;
      this.logger.log('[KeyclubService] ✅ Token obtido com sucesso!');
      this.logger.log(`[KeyclubService] Token (primeiros 20 chars): ${this.token.substring(0, 20)}...`);
      return this.token;
      
    } catch (e) {
      const ax = e as AxiosError<any>;
      
      if (ax.response) {
        this.logger.error(`[KeyclubService] ❌ Erro HTTP: status=${ax.response.status}`);
        this.logger.error(`[KeyclubService] Response headers: ${JSON.stringify(ax.response.headers)}`);
        this.logger.error(`[KeyclubService] Response data: ${JSON.stringify(ax.response.data)}`);
        
        if (ax.response.status === 403) {
          this.logger.error(`[KeyclubService] 🚫 ERRO 403: Credenciais inválidas ou acesso negado`);
          this.logger.error(`[KeyclubService] Verifique se o Client ID e Secret estão corretos no painel da KeyClub`);
          this.logger.error(`[KeyclubService] Client ID usado: ${clientId}`);
        }
        
        throw new Error(`Erro ${ax.response.status}: ${ax.response.data?.message || 'Falha na autenticação'}`);
      }
      
      if (ax.request) {
        this.logger.error(`[KeyclubService] ❌ Sem resposta do servidor`);
        this.logger.error(`[KeyclubService] Request: ${JSON.stringify(ax.request).substring(0, 200)}`);
        throw new Error('Sem resposta da KeyClub API - Verifique a conectividade');
      }
      
      this.logger.error(`[KeyclubService] ❌ Erro ao configurar requisição: ${ax.message}`);
      throw new Error(`Erro na requisição: ${ax.message}`);
    }
  }

  async createDeposit(input: CreateDepositInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1.0) {
      throw new Error('Valor mínimo para depósito é R$ 1,00.');
    }

    const callback =
      input.clientCallbackUrl ||
      process.env.KEY_CLUB_CALLBACK_URL ||
      `${process.env.BASE_URL}/api/v1/keyclub/callback`;

    const doc = input.payer?.document?.toString().replace(/\D/g, '');
    if (!doc || doc.length < 11) {
      throw new Error('Documento do pagador inválido.');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
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
        `[KeyclubService] 💰 Criando depósito: ${payload.external_id} - R$ ${payload.amount}`,
      );
      const url = `${this.baseUrl}/api/payments/deposit`;
      const { data, status } = await axios.post(url, payload, {
        ...this.axiosConfig,
        headers: this.authHeaders(),
      });

      this.logger.log(`[KeyclubService] ✅ Depósito criado: status=${status}`);
      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] ❌ Erro ao criar depósito: ${ax.response.status}`,
        );
        this.logger.error(
          `[KeyclubService] Response: ${JSON.stringify(ax.response.data)}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      throw new Error('Falha ao comunicar com KeyClub');
    }
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1.0) {
      throw new Error('Valor mínimo para saque é R$ 1,00.');
    }

    const payload = {
      amount: Number(amount.toFixed(2)),
      external_id: input.externalId,
      pix_key: input.pix_key,
      key_type: input.key_type,
      description: input.description,
      clientCallbackUrl: input.clientCallbackUrl,
    };

    try {
      this.logger.log(
        `[KeyclubService] 💸 Solicitando saque: ${payload.external_id} - R$ ${payload.amount}`,
      );
      const url = `${this.baseUrl}/api/withdrawals/withdraw`;
      const { data, status } = await axios.post(url, payload, {
        ...this.axiosConfig,
        headers: this.authHeaders(),
      });

      this.logger.log(`[KeyclubService] ✅ Saque criado: status=${status}`);
      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] ❌ Erro ao criar saque: ${ax.response.status}`,
        );
        this.logger.error(
          `[KeyclubService] Response: ${JSON.stringify(ax.response.data)}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      throw new Error('Falha ao comunicar com KeyClub para saque.');
    }
  }
}