// src/deposit/deposit.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { KeyclubService } from '../keyclub/keyclub.service';
import { PrismaService } from 'src/prisma/prisma.service';
import * as crypto from 'crypto';

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
    this.logger.log(`[DepositService] ==========================================`);
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);
    this.logger.log(`[DepositService] Valor recebido: ${dto.amount} centavos`);
    
    // ✅ VALIDAÇÃO DO VALOR MÍNIMO
    if (!dto.amount || dto.amount < 100) { // Mínimo R$ 1,00
      throw new BadRequestException('Valor mínimo de depósito é R$ 1,00');
    }
    
    // ✅ CONVERSÃO CORRETA: Centavos -> BRL
    const amountInBRL = dto.amount / 100;
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
        throw new BadRequestException('Merchant não encontrado. Configure seus dados cadastrais primeiro.');
      }

      const merchant = user.merchant;

      // 2. Validação dos dados obrigatórios
      if (!merchant.storeName || !merchant.cnpj || !user.email) {
        this.logger.error(`[DepositService] ❌ Dados incompletos.`);
        this.logger.error(`   Merchant: ${merchant.storeName}`);
        this.logger.error(`   CNPJ: ${merchant.cnpj}`);
        this.logger.error(`   Email: ${user.email}`);
        throw new BadRequestException('Dados do merchant incompletos (CNPJ, Nome ou Email faltando).');
      }

      const cleanDocument = merchant.cnpj.replace(/\D/g, '');

      // ✅ USA O NOME DO USUÁRIO (não da loja)
      const payerName = user.name || merchant.storeName;
      
      this.logger.log(`[DepositService] 👤 Pagador: ${payerName}`);
      this.logger.log(`[DepositService] 📧 Email: ${user.email}`);
      this.logger.log(`[DepositService] 📄 Documento: ${cleanDocument}`);

      // 3. ✅ MONTA PAYLOAD NO FORMATO DA KEYCLUB
      const callbackUrl = dto.callbackUrl || 
        process.env.KEY_CLUB_CALLBACK_URL || 
        `${process.env.BASE_URL}/api/webhooks/keyclub`;

      const keyclubPayload = {
        amount: amountInBRL, // Em BRL (ex: 10.00)
        external_id: finalExternalId,
        clientCallbackUrl: callbackUrl,
        payer: {
          name: payerName, // ✅ NOME DO USUÁRIO
          email: user.email,
          document: cleanDocument,
        }
      };

      this.logger.log('[DepositService] 📦 Payload para KeyClub:');
      this.logger.log(JSON.stringify(keyclubPayload, null, 2));

      // 4. ✅ CHAMA A KEYCLUB
      const keyclubResult = await this.keyclub.createDeposit(keyclubPayload);

      this.logger.log('[DepositService] 🔥 Resposta da KeyClub:');
      this.logger.log(JSON.stringify(keyclubResult, null, 2));

      // 5. ✅ EXTRAI DADOS DA RESPOSTA
      const qr = keyclubResult?.qrCodeResponse || keyclubResult;
      const transactionId = qr?.transactionId;
      const qrCode = qr?.qrcode;

      if (!transactionId) {
        this.logger.error('[DepositService] ❌ KeyClub não retornou transactionId.');
        this.logger.error('[DepositService] Resposta completa:', JSON.stringify(keyclubResult, null, 2));
        throw new BadRequestException('Falha ao obter transactionId da KeyClub.');
      }

      if (!qrCode) {
        this.logger.error('[DepositService] ❌ KeyClub não retornou QR Code.');
        throw new BadRequestException('Falha ao obter QR Code da KeyClub.');
      }

      // 6. Gera Token do Webhook
      const uniqueToken = crypto.randomBytes(20).toString('hex');

      // 7. SALVA NO PRISMA
      this.logger.log(`[DepositService] 💾 Salvando no banco de dados...`);
      
      const newDeposit = await this.prisma.deposit.create({
        data: {
          externalId: transactionId,
          amountInCents: dto.amount,
          netAmountInCents: dto.amount,
          status: 'PENDING',
          payerName: payerName, // ✅ NOME DO USUÁRIO
          payerEmail: user.email,
          payerDocument: cleanDocument,
          webhookToken: uniqueToken,
          user: { connect: { id: userId } },
        },
      });
      
      this.logger.log(`[DepositService] ✅ SUCESSO TOTAL!`);
      this.logger.log(`   🆔 Depósito ID: ${newDeposit.id}`);
      this.logger.log(`   🎫 Transaction ID: ${transactionId}`);
      this.logger.log(`   💰 Valor: R$ ${amountInBRL.toFixed(2)}`);
      this.logger.log(`   📱 QR Code: ${qrCode.substring(0, 50)}...`);
      this.logger.log(`==========================================`);

      return {
        message: 'Deposit created successfully.',
        transactionId: transactionId,
        status: qr?.status || 'PENDING',
        qrcode: qrCode, // ✅ RETORNA O QR CODE CORRETO
        amount: dto.amount,
      };
      
    } catch (err) {
      const error = err as Error;
      const msg = error.message || 'Erro desconhecido';
      this.logger.error(`[DepositService] ❌ ERRO FATAL: ${msg}`);
      this.logger.error(error.stack);
      
      // ✅ LANÇA ERRO COM MENSAGEM CLARA
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }
      
      throw new BadRequestException(`Erro ao processar depósito: ${msg}`);
    }
  }
}