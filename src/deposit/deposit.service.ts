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
    
    // ✅ VALIDAÇÃO DO VALOR MÍNIMO
    if (!dto.amount || dto.amount < 100) { // Mínimo R$ 1,00
      throw new BadRequestException('Valor mínimo de depósito é R$ 1,00');
    }
    
    const amountInBRL = dto.amount / 100;
    const finalExternalId = dto.externalId || crypto.randomUUID();

    try {
      // 1. Busca Usuário e Merchant
      // Buscamos o merchant, mas não obrigamos o CNPJ dele ser o pagador se tiver CPF pessoal
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { merchant: true }
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado.');
      }

      // Hack para acessar propriedades dinâmicas caso o TS reclame (cpf/document)
      const userData = user as any;

      // 2. Lógica Inteligente de Documento (Smart Document Picker)
      // Tenta: CNPJ do Merchant -> OU CPF do Usuário -> OU Documento genérico
      const rawDocument = user.merchant?.cnpj || userData.cpf || userData.document || '';
      const cleanDocument = rawDocument.replace(/\D/g, '');
      
      const payerName = user.name || user.merchant?.storeName || 'Cliente Paylure';

      this.logger.log(`[DepositService] 👤 Pagador Identificado: ${payerName}`);
      this.logger.log(`[DepositService] 📄 Documento Bruto: ${rawDocument}`);
      this.logger.log(`[DepositService] 📄 Documento Limpo: ${cleanDocument}`);

      // 3. ✅ VALIDAÇÃO PREVENTIVA (Onde estava o erro)
      if (!cleanDocument || cleanDocument.length < 11) {
        this.logger.error(`[DepositService] ❌ Documento inválido ou muito curto: "${cleanDocument}"`);
        throw new BadRequestException(
          'CPF/CNPJ inválido no seu cadastro. Por favor, atualize seus dados (CPF ou CNPJ) no perfil.'
        );
      }

      if (!user.email) {
        throw new BadRequestException('Email é obrigatório para gerar o Pix.');
      }

      // 4. CHAMA A KEYCLUB
      const keyclubResult = await this.keyclub.createDeposit({
        amount: amountInBRL,
        externalId: finalExternalId,
        payerName: payerName,
        payerEmail: user.email,
        payerDocument: cleanDocument,
      });

      this.logger.log('[DepositService] 🔥 Resposta da KeyClub Recebida');

      // 5. Verifica resposta
      const transactionId = keyclubResult.transactionId;
      const qrCode = keyclubResult.qrcode;

      if (!transactionId || !qrCode) {
        this.logger.error('[DepositService] ❌ Resposta incompleta da KeyClub.');
        throw new BadRequestException('Erro ao gerar QR Code na adquirente.');
      }

      // 6. Gera Token do Webhook e Salva
      const uniqueToken = crypto.randomBytes(20).toString('hex');

      this.logger.log(`[DepositService] 💾 Salvando no banco de dados...`);
      
      const newDeposit = await this.prisma.deposit.create({
        data: {
          externalId: transactionId,
          amountInCents: dto.amount,
          netAmountInCents: dto.amount,
          status: 'PENDING',
          payerName: payerName,
          payerEmail: user.email,
          payerDocument: cleanDocument,
          webhookToken: uniqueToken,
          user: { connect: { id: userId } },
        },
      });
      
      this.logger.log(`[DepositService] ✅ SUCESSO TOTAL! ID: ${newDeposit.id}`);

      return {
        message: 'Deposit created successfully.',
        transactionId: transactionId,
        status: keyclubResult.status || 'PENDING',
        qrcode: qrCode,
        amount: dto.amount,
      };
      
    } catch (err) {
      const error = err as Error;
      this.logger.error(`[DepositService] ❌ ERRO: ${error.message}`);
      
      // Repassa erros HTTP já conhecidos
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }
      
      // Trata erros genéricos
      throw new BadRequestException(`Erro ao processar depósito: ${error.message}`);
    }
  }
}