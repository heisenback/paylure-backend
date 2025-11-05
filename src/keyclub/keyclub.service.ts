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
      rejectUnauthorized: false, // Temporário para debug
    }),
    timeout: 30000,
  };

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Paylure-Gateway/1.0',
      'X-Forwarded-For': '177.11.0.1', // IP brasileiro simulado
    };
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const clientId = (process.env.KEY_CLUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.KEY_CLUB_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      throw new Error(
        'Credenciais da KeyClub ausentes. Configure KEY_CLUB_CLIENT_ID e KEY_CLUB_CLIENT_SECRET no .env.',
      );
    }

    try {
      this.logger.log(`[KeyclubService] Autenticando com KeyClub...`);
      this.logger.log(`[KeyclubService] URL: ${this.baseUrl}/api/auth/login`);
      this.logger.log(`[KeyclubService] Client ID: ${clientId.substring(0, 20)}...`);

      const url = `${this.baseUrl}/api/auth/login`;
      const { data, status } = await axios.post(
        url,
        {
          client_id: clientId,
          client_secret: clientSecret,
        },
        {
          ...this.axiosConfig,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Paylure-Gateway/1.0',
            'X-Forwarded-For': '177.11.0.1',
          },
        },
      );

      this.logger.log(`[KeyclubService] Resposta da autenticação: status=${status}`);

      const accessToken = data?.token;
      if (!accessToken) {
        this.logger.error(`[KeyclubService] Resposta sem token: ${JSON.stringify(data)}`);
        throw new Error('Resposta sem token.');
      }

      this.token = accessToken as string;
      this.logger.log('[KeyclubService] ✅ Token obtido com sucesso!');
      return this.token;
    } catch (e) {
      const ax = e as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] Erro HTTP: status=${ax.response.status}`,
        );
        this.logger.error(
          `[KeyclubService] Response data: ${JSON.stringify(ax.response.data).substring(0, 500)}`,
        );
        throw new Error('Falha na autenticação da KeyClub - verifique as credenciais.');
      }
      this.logger.error(`[KeyclubService] Erro de rede: ${ax.message}`);
      throw new Error('Falha de rede ao comunicar com KeyClub.');
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
        `[KeyclubService] Criando depósito: ${payload.external_id} - R$ ${payload.amount}`,
      );
      const url = `${this.baseUrl}/api/payments/deposit`;
      const { data, status } = await axios.post(url, payload, {
        ...this.axiosConfig,
        headers: this.authHeaders(),
      });

      this.logger.log(`[KeyclubService] Depósito criado: status=${status}`);
      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] Erro ao criar depósito: ${ax.response.status}`,
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
        `[KeyclubService] Solicitando saque: ${payload.external_id} - R$ ${payload.amount}`,
      );
      const url = `${this.baseUrl}/api/withdrawals/withdraw`;
      const { data, status } = await axios.post(url, payload, {
        ...this.axiosConfig,
        headers: this.authHeaders(),
      });

      this.logger.log(`[KeyclubService] Saque criado: status=${status}`);
      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] Erro ao criar saque: ${ax.response.status}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      throw new Error('Falha ao comunicar com KeyClub para saque.');
    }
  }
}