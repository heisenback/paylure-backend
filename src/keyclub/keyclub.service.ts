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
  // 🚨 CORREÇÃO: Adicionado 'EVP' aos tipos permitidos
  key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM' | 'EVP';
  description?: string;
  clientCallbackUrl: string;
};

@Injectable()
export class KeyclubService {
  private readonly logger = new Logger(KeyclubService.name);
  private readonly baseUrl = process.env.KEY_CLUB_BASE_URL?.replace(/\/+$/, '') || 'https://api.the-key.club';
  private token: string | null = null;
  private cookies: string = '';

  private readonly axiosInstance = axios.create({
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    timeout: 30000,
    maxRedirects: 5,
  });

  private getHeaders(includeAuth = false) {
    const headers: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      'Origin': 'https://the-key.club',
      'Referer': 'https://the-key.club/',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
    };

    if (this.cookies) {
      headers['Cookie'] = this.cookies;
    }

    if (includeAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;

    const clientId = process.env.KEY_CLUB_CLIENT_ID?.trim().replace(/^"|"$/g, '');
    const clientSecret = process.env.KEY_CLUB_CLIENT_SECRET?.trim().replace(/^"|"$/g, '');

    if (!clientId || !clientSecret) {
      this.logger.error('[KeyclubService] ❌ Credenciais ausentes no .env');
      throw new Error('Credenciais da KeyClub ausentes.');
    }

    try {
      this.logger.log(`[KeyclubService] 🔐 Autenticando com KeyClub...`);
      this.logger.log(`[KeyclubService] URL: ${this.baseUrl}/api/auth/login`);
      this.logger.log(`[KeyclubService] Client ID: ${clientId}`);

      const url = `${this.baseUrl}/api/auth/login`;
      const payload = {
        client_id: clientId,
        client_secret: clientSecret,
      };

      // Aguardar para não parecer bot
      await new Promise(resolve => setTimeout(resolve, 1500));

      const response = await this.axiosInstance.post(url, payload, {
        headers: this.getHeaders(false),
        validateStatus: (status) => status < 500, // Aceitar até 499
      });

      // Salvar cookies da resposta
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader) {
        this.cookies = setCookieHeader.map(cookie => cookie.split(';')[0]).join('; ');
        this.logger.log('[KeyclubService] 🍪 Cookies salvos');
      }

      this.logger.log(`[KeyclubService] Status: ${response.status}`);

      if (response.status === 403) {
        const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        
        if (responseText.includes('Cloudflare') || responseText.includes('cf-ray')) {
          this.logger.error(`[KeyclubService] 🛡️ BLOQUEADO PELO CLOUDFLARE`);
          this.logger.error(`[KeyclubService] IP: 62.171.175.190 - Verifique se está na whitelist`);
          this.logger.error(`[KeyclubService] Entre em contato com suporte KeyClub`);
          throw new Error('IP bloqueado pelo Cloudflare - Entre em contato com KeyClub');
        }

        this.logger.error(`[KeyclubService] ❌ Erro 403 - Credenciais inválidas`);
        throw new Error('Credenciais inválidas - Verifique Client ID e Secret');
      }

      if (response.status >= 400) {
        this.logger.error(`[KeyclubService] ❌ Erro ${response.status}`);
        this.logger.error(`[KeyclubService] Response: ${JSON.stringify(response.data).substring(0, 500)}`);
        throw new Error(`Erro na autenticação: ${response.status}`);
      }

      const data = response.data;
      const accessToken = data?.token || data?.access_token || data?.accessToken || data?.data?.token;

      if (!accessToken) {
        this.logger.error(`[KeyclubService] ❌ Token não encontrado na resposta`);
        this.logger.error(`[KeyclubService] Response: ${JSON.stringify(data).substring(0, 500)}`);
        throw new Error('Token não encontrado na resposta');
      }

      this.token = accessToken as string;
      this.logger.log('[KeyclubService] ✅ Autenticação bem-sucedida!');
      this.logger.log(`[KeyclubService] Token: ${this.token.substring(0, 20)}...`);
      return this.token;

    } catch (e) {
      const ax = e as AxiosError<any>;

      if (ax.response) {
        const status = ax.response.status;
        const responseText = typeof ax.response.data === 'string' ? ax.response.data : JSON.stringify(ax.response.data);

        this.logger.error(`[KeyclubService] ❌ Erro HTTP: ${status}`);

        if (responseText.includes('Cloudflare') || responseText.includes('cf-ray')) {
          this.logger.error(`[KeyclubService] 🛡️ BLOQUEADO PELO CLOUDFLARE`);
          throw new Error('IP bloqueado pelo Cloudflare - Contate o suporte da KeyClub');
        }

        if (status === 403) {
          this.logger.error(`[KeyclubService] 🚫 Acesso negado - Verifique credenciais`);
          throw new Error('Acesso negado - Credenciais inválidas');
        }

        throw new Error(`Erro ${status}: ${ax.response.data?.message || 'Erro na API'}`);
      }

      if (ax.request) {
        this.logger.error(`[KeyclubService] ❌ Sem resposta do servidor`);
        throw new Error('Sem resposta da KeyClub - Verifique conectividade');
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

    const callback = input.clientCallbackUrl || process.env.KEY_CLUB_CALLBACK_URL || `${process.env.BASE_URL}/api/v1/keyclub/callback`;
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
      this.logger.log(`[KeyclubService] 💰 Criando depósito: R$ ${payload.amount}`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const url = `${this.baseUrl}/api/payments/deposit`;
      const response = await this.axiosInstance.post(url, payload, {
        headers: this.getHeaders(true),
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        this.logger.error(`[KeyclubService] ❌ Erro ao criar depósito: ${response.status}`);
        throw new Error(response.data?.message || 'Erro ao criar depósito');
      }

      this.logger.log(`[KeyclubService] ✅ Depósito criado com sucesso`);
      return response.data;
      
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(`[KeyclubService] ❌ Erro: ${ax.response.status}`);
        throw new Error(ax.response.data?.message || 'Erro da API');
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
      this.logger.log(`[KeyclubService] 💸 Solicitando saque: R$ ${payload.amount}`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const url = `${this.baseUrl}/api/withdrawals/withdraw`;
      const response = await this.axiosInstance.post(url, payload, {
        headers: this.getHeaders(true),
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        this.logger.error(`[KeyclubService] ❌ Erro ao criar saque: ${response.status}`);
        throw new Error(response.data?.message || 'Erro ao criar saque');
      }

      this.logger.log(`[KeyclubService] ✅ Saque criado com sucesso`);
      return response.data;
      
    } catch (error) {
      const ax = error as AxiosError<any>;
      if (ax.response) {
        this.logger.error(`[KeyclubService] ❌ Erro: ${ax.response.status}`);
        throw new Error(ax.response.data?.message || 'Erro da API');
      }
      throw new Error('Falha ao comunicar com KeyClub');
    }
  }
}