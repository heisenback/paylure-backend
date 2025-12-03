import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';
import { PrismaService } from 'src/prisma/prisma.service';
import * as crypto from 'crypto'; // Usado para gerar IDs únicos

// O DTO que este serviço REALMENTE espera (vem do controller)
export type CreateDepositServiceDto = {
  amount: number; // EM CENTAVOS
  externalId?: string;
  callbackUrl?: string;
};

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    private readonly keyclub: KeyclubService,
    private readonly prisma: PrismaService, 
  ) {}

  async createDeposit(userId: string, dto: CreateDepositServiceDto) {
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    
    const amountInBRL = dto.amount / 100;

    // 🔥 CORREÇÃO 1: Garante que SEMPRE exista um externalId
    // Se o frontend não mandar, a gente cria um agora mesmo.
    const finalExternalId = dto.externalId || crypto.randomUUID();

    this.logger.log(
      `[DepositService] Iniciando depósito de R$${amountInBRL.toFixed(2)} ` +
      `| ID: ${finalExternalId}`
    );

    try {
      // 1. Busca Usuário e Merchant
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { merchant: true }
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      if (!user.merchant) {
        throw new Error('Merchant não encontrado. Configure seus dados cadastrais primeiro.');
      }

      const merchant = user.merchant;

      // 2. Validação dos dados obrigatórios
      if (!merchant.storeName || !merchant.cnpj || !user.email) {
        this.logger.error(`[DepositService] ❌ Dados incompletos. Merchant: ${merchant.storeName}, CNPJ: ${merchant.cnpj}, Email: ${user.email}`);
        throw new Error('Dados do merchant incompletos (CNPJ, Nome ou Email faltando).');
      }

      // Limpa o CNPJ (remove pontos e traços) para enviar apenas números
      const cleanDocument = merchant.cnpj.replace(/\D/g, '');

      this.logger.log(`[DepositService] 🚀 Enviando para Keyclub: Payer=${merchant.storeName}, Doc=${cleanDocument}`);

      // 3. CHAMA A KEYCLUB (Aqui estava o erro)
      const keyclubResult = await this.keyclub.createDeposit({
        amount: amountInBRL, 
        externalId: finalExternalId, // ✅ Agora garantimos que isso nunca é undefined
        clientCallbackUrl: dto.callbackUrl || 'https://api.paylure.com.br/api/webhooks/keyclub', // Fallback se não vier
        payer: {
          name: merchant.storeName,
          email: user.email,
          document: cleanDocument,
          // phone: undefined -- Removido para evitar erro de build
        },
      });

      const qr = keyclubResult?.qrCodeResponse || keyclubResult;
      const transactionId = qr?.transactionId;

      if (!transactionId) {
        this.logger.error('[DepositService] ❌ KeyClub não retornou transactionId.');
        throw new Error('Falha ao obter transactionId da KeyClub.');
      }

      // 4. Gera Token do Webhook
      const uniqueToken = crypto.randomBytes(20).toString('hex');

      // 5. SALVA NO PRISMA (Agora vai chegar aqui!)
      this.logger.log(`[DepositService] Salvando no DB...`);
      
      const newDeposit = await this.prisma.deposit.create({
        data: {
          externalId: transactionId, // ID da Keyclub
          amountInCents: dto.amount,
          netAmountInCents: dto.amount,
          status: 'PENDING',
          payerName: merchant.storeName,
          payerEmail: user.email,
          payerDocument: merchant.cnpj,
          webhookToken: uniqueToken,
          user: { connect: { id: userId } },
        },
      });
      
      this.logger.log(`[DepositService] ✅ Sucesso! Depósito salvo: ${newDeposit.id}`);

      return {
        message: 'Deposit created successfully.',
        transactionId: transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        amount: dto.amount,
      };
      
    } catch (err) {
      const msg = (err as Error).message || 'Erro desconhecido';
      this.logger.error(`[DepositService] ❌ ERRO: ${msg}`, (err as Error).stack);
      
      // Relança o erro para o Controller pegar e mostrar pro usuário
      throw new Error(msg);
    }
  }
}