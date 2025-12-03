// src/deposit/service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDepositDto } from './dto/create-deposit.dto'; 
import * as crypto from 'crypto';

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

  // 🔥 CORREÇÃO: Agora busca os dados do MERCHANT ao invés do usuário
  async createDeposit(userId: string, dto: CreateDepositServiceDto) {
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    
    const amountInBRL = dto.amount / 100;

    this.logger.log(
      `[DepositService] Iniciando depósito de R$${amountInBRL.toFixed(2)} ` +
      `(${dto.amount} centavos)`
    );

    try {
      // 🔥 BUSCA O USUÁRIO E SEU MERCHANT ASSOCIADO
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { 
          merchant: true // Inclui os dados do Merchant
        }
      });

      if (!user) {
        this.logger.error(`[DepositService] ❌ Usuário ${userId} não encontrado.`);
        throw new NotFoundException('Usuário não encontrado.');
      }

      if (!user.merchant) {
        this.logger.error(`[DepositService] ❌ Usuário ${userId} não possui merchant associado.`);
        throw new Error('Merchant não encontrado. Configure seus dados cadastrais primeiro.');
      }

      const merchant = user.merchant;

      // 🔥 VALIDA SE O MERCHANT TEM OS DADOS OBRIGATÓRIOS
      // O Merchant tem: storeName, cnpj, e o User tem: name, email
      if (!merchant.storeName || !merchant.cnpj || !user.email) {
        this.logger.error(`[DepositService] ❌ Merchant ${merchant.id} está com dados incompletos.`);
        throw new Error('Dados do merchant incompletos. Complete seu cadastro antes de gerar PIX.');
      }

      this.logger.log(`[DepositService] ✅ Usando dados do Merchant: ${merchant.storeName} (${merchant.cnpj})`);

      // 3. CHAMA A KEYCLUB COM OS DADOS DO MERCHANT + USER
      const keyclubResult = await this.keyclub.createDeposit({
        amount: amountInBRL, 
        externalId: dto.externalId,
        clientCallbackUrl: dto.callbackUrl,
        payer: {
          name: merchant.storeName, // Nome da loja
          email: user.email, // Email do usuário
          document: merchant.cnpj.replace(/\D/g, ''), // CNPJ limpo
          phone: user.phone || undefined, // Telefone do usuário (se existir)
        },
      });

      const qr = keyclubResult?.qrCodeResponse || keyclubResult;
      const transactionId = qr?.transactionId;

      if (!transactionId) {
        this.logger.error('[DepositService] ❌ KeyClub não retornou um transactionId.');
        throw new Error('Falha ao obter transactionId da KeyClub.');
      }

      // 4. ✅ GERA O TOKEN ÚNICO OBRIGATÓRIO
      const uniqueToken = crypto.randomBytes(20).toString('hex');

      // 5. ✅ SALVA O DEPÓSITO "PENDENTE" NO BANCO DE DADOS
      this.logger.log(`[DepositService] Salvando depósito PENDENTE no DB: ${transactionId}`);
      
      const newDeposit = await this.prisma.deposit.create({
        data: {
          externalId: transactionId,
          amountInCents: dto.amount,
          netAmountInCents: dto.amount, // Valor líquido será atualizado pelo webhook
          status: 'PENDING',
          payerName: merchant.storeName, // Nome da loja
          payerEmail: user.email, // Email do usuário
          payerDocument: merchant.cnpj, // CNPJ
          webhookToken: uniqueToken, // ✅ CAMPO OBRIGATÓRIO ADICIONADO
          user: { connect: { id: userId } },
        },
      });
      
      this.logger.log(`[DepositService] ✅ Depósito ${newDeposit.id} salvo com externalId ${transactionId}`);

      // 6. RETORNA PARA O FRONTEND
      const response = {
        message: keyclubResult?.message || 'Deposit created successfully.',
        transactionId: transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qr?.qrcode,
        amount: dto.amount,
      };
      
      return response;
      
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao criar depósito.';
      
      if (err.code === 'P2002' && err.meta?.target?.includes('webhookToken')) {
        this.logger.error(`[DepositService] ❌ Conflito de Token. Tentando novamente...`);
        throw new Error('Erro ao gerar token, tente novamente.');
      }
      
      this.logger.error(`[DepositService] ❌ Erro inesperado: ${msg}`, (err as Error).stack);
      throw new Error(`Erro ao criar depósito: ${msg}`);
    }
  }
}