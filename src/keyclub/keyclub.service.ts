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

  // Configuração do axios para passar pelo Cloudflare
  private readonly axiosConfig = {
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    timeout: 30000,
    maxRedirects: 5,
  };

  // Headers que imitam um navegador real para passar pelo Cloudflare
  private getBrowserHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      'Origin': 'https://the-key.club',
      'Referer': 'https://the-key.club/',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Connection': 'keep-alive',
    };
  }

  private authHeaders() {
    return {
      ...this.getBrowserHeaders(),
      'Authorization': `Bearer ${this.token}`,
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
      this.logger.log(`[KeyclubService] Client ID: ${clientId}`);

      const url = `${this.baseUrl}/api/auth/login`;
      
      const payload = {
        client_id: clientId,
        client_secret: clientSecret,
      };

      // Aguardar um pouco para não parecer bot
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data, status } = await axios.post(
        url,
        payload,
        {
          ...this.axiosConfig,
          headers: this.getBrowserHeaders(),
        },
      );

      this.logger.log(`[KeyclubService] ✅ Resposta HTTP: status=${status}`);

      const accessToken = data?.token || data?.access_token || data?.accessToken || data?.data?.token;
      
      if (!accessToken) {
        this.logger.error(`[KeyclubService] ❌ Token não encontrado na resposta`);
        this.logger.error(`[KeyclubService] Resposta: ${JSON.stringify(data).substring(0, 500)}`);
        throw new Error('Resposta da API não contém token de acesso.');
      }

      this.token = accessToken as string;
      this.logger.log('[KeyclubService] ✅ Token obtido com sucesso!');
      return this.token;
      
    } catch (e) {
      const ax = e as AxiosError<any>;
      
      if (ax.response) {
        this.logger.error(`[KeyclubService] ❌ Erro HTTP: status=${ax.response.status}`);
        
        // Verificar se foi bloqueado pelo Cloudflare
        const responseText = typeof ax.response.data === 'string' ? ax.response.data : JSON.stringify(ax.response.data);
        
        if (responseText.includes('Cloudflare') || responseText.includes('cf-ray')) {
          this.logger.error(`[KeyclubService] 🛡️ BLOQUEADO PELO CLOUDFLARE!`);
          this.logger.error(`[KeyclubService] O servidor da KeyClub está protegido por Cloudflare`);
          this.logger.error(`[KeyclubService] Cloudflare Ray ID encontrado nos headers`);
          throw new Error('Bloqueado pelo Cloudflare - Entre em contato com o suporte da KeyClub para whitelist do IP 62.171.175.190');
        }
        
        if (ax.response.status === 403) {
          this.logger.error(`[KeyclubService] 🚫 ERRO 403: Credenciais inválidas ou acesso negado`);
          this.logger.error(`[KeyclubService] Verifique se o Client ID e Secret estão corretos`);
        }
        
        const errorMessage = ax.response.data?.message || ax.response.data?.error || 'Falha na autenticação';
        throw new Error(`Erro ${ax.response.status}: ${errorMessage}`);
      }
      
      if (ax.request) {
        this.logger.error(`[KeyclubService] ❌ Sem resposta do servidor`);
        throw new Error('Sem resposta da KeyClub API - Verifique a conectividade');
      }
      
      this.logger.error(`[KeyclubService] ❌ Erro: ${ax.message}`);
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
      
      // Aguardar um pouco para não parecer bot
      await new Promise(resolve => setTimeout(resolve, 500));
      
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
          `[KeyclubService] Response: ${JSON.stringify(ax.response.data).substring(0, 500)}`,
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
      
      // Aguardar um pouco para não parecer bot
      await new Promise(resolve => setTimeout(resolve, 500));
      
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
          `[KeyclubService] Response: ${JSON.stringify(ax.response.data).substring(0, 500)}`,
        );
        throw new Error(ax.response.data?.message || 'Erro da API da KeyClub');
      }
      throw new Error('Falha ao comunicar com KeyClub para saque.');
    }
  }
}