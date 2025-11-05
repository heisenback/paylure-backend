// src/keyclub/keyclub.service.ts
import axios, { AxiosError } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

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

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      Origin: 'https://api.paylure.com.br',
      Referer: 'https://api.paylure.com.br/',
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
      this.logger.log('[KeyclubService] Autenticando: tentando /api/auth/login…');
      const url = `${this.baseUrl}/api/auth/login`;
      const { data } = await axios.post(
        url,
        {
          client_id: clientId,
          client_secret: clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            Origin: 'https://api.paylure.com.br',
            Referer: 'https://api.paylure.com.br/',
          },
        },
      );

      const accessToken = data?.token;
      if (!accessToken) throw new Error('Resposta sem token.');

      this.token = accessToken as string;
      this.logger.log('[KeyclubService] ✅ Token obtido com sucesso!');
      return this.token;
    } catch (e) {
      const ax = e as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] /api/auth/login falhou: status=${ax.response.status}`,
        );
        throw new Error(ax.response.data?.message || 'Falha na autenticação da KeyClub.');
      }
      this.logger.error(`[KeyclubService] Erro de rede na autenticação: ${ax.message}`);
      throw new Error('Falha de rede ao comunicar com KeyClub para autenticação.');
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
        `[KeyclubService] Criando depósito: external_id=${payload.external_id}, amount=${payload.amount}`,
      );
      const url = `${this.baseUrl}/api/payments/deposit`;
      const { data, status } = await axios.post(url, payload, { headers: this.authHeaders() });

      if (status !== 201) {
        this.logger.error(`[KeyclubService] Status inesperado: ${status}`);
        throw new Error(data?.message || 'Falha na criação do depósito no KeyClub.');
      }

      this.logger.log('[KeyclubService] ✅ Depósito criado com sucesso!');
      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] Erro na criação de depósito: status=${ax.response.status}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      this.logger.error(`[KeyclubService] Erro de rede/axios: ${ax.message}`);
      throw new Error('Falha ao comunicar com KeyClub');
    }
  }

  async createWithdrawal(input: CreateWithdrawalInput) {
    await this.ensureToken();

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 1.0) {
      throw new Error('Valor mínimo para saque é R$ 1,00.');
    }

    if (!this.baseUrl) {
      throw new Error('KEY_CLUB_BASE_URL não configurada.');
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
        `[KeyclubService] Solicitando saque: external_id=${payload.external_id}, amount=${payload.amount}`,
      );
      const url = `${this.baseUrl}/api/withdrawals/withdraw`;
      const { data, status } = await axios.post(url, payload, { headers: this.authHeaders() });

      if (status !== 200) {
        this.logger.error(`[KeyclubService] Status inesperado: ${status}`);
        throw new Error(data?.message || 'Falha na solicitação de saque no KeyClub.');
      }

      this.logger.log('[KeyclubService] ✅ Saque criado com sucesso!');
      return data;
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(
          `[KeyclubService] Erro na solicitação de saque: status=${ax.response.status}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      throw new Error('Falha ao comunicar com KeyClub para saque.');
    }
  }
}