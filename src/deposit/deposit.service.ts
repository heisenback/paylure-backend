// src/deposit/deposit.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as crypto from 'crypto';

// ✅ NOVO
import { XflowService } from '../xflow/xflow.service';

export type CreateDepositServiceDto = {
  amount: number; // EM CENTAVOS
  externalId?: string;
  callbackUrl?: string;
  payerDocument?: string;
};

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    // ✅ TROCA AQUI
    private readonly xflow: XflowService,
    private readonly prisma: PrismaService,
  ) {}

  async createDeposit(userId: string, dto: CreateDepositServiceDto) {
    this.logger.log(`[DepositService] ==========================================`);
    this.logger.log(`[DepositService] createDeposit chamado para userId=${userId}`);

    if (!dto.amount || dto.amount < 100) {
      throw new BadRequestException('Valor mínimo de depósito é R$ 1,00');
    }

    const amountInBRL = dto.amount / 100;
    const finalExternalId = dto.externalId || crypto.randomUUID();

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { merchant: true },
      });

      if (!user) throw new NotFoundException('Usuário não encontrado.');

      const userData = user as any;

      const rawDocument = dto.payerDocument || user.merchant?.cnpj || userData.cpf || userData.document || '';
      const cleanDocument = rawDocument.replace(/\D/g, '');

      const payerName = user.name || user.merchant?.storeName || 'Cliente Paylure';

      this.logger.log(`[DepositService] 👤 Pagador Identificado: ${payerName}`);
      this.logger.log(
        `[DepositService] 📄 Documento Bruto (Origem: ${dto.payerDocument ? 'Frontend' : 'Banco'}): ${rawDocument}`,
      );
      this.logger.log(`[DepositService] 📄 Documento Limpo: ${cleanDocument}`);

      if (!cleanDocument || cleanDocument.length < 11) {
        this.logger.error(`[DepositService] ❌ Documento inválido ou muito curto: "${cleanDocument}"`);
        throw new BadRequestException('CPF/CNPJ inválido ou não informado. Por favor, verifique seus dados.');
      }

      if (!user.email) {
        throw new BadRequestException('Email é obrigatório para gerar o Pix.');
      }

      // ✅ CHAMA XFLOW AGORA
      const xflowResult = await this.xflow.createDeposit({
        amount: amountInBRL,
        externalId: finalExternalId,
        payerName,
        payerEmail: user.email,
        payerDocument: cleanDocument,
      });

      this.logger.log('[DepositService] 🔥 Resposta da Xflow Recebida');

      const transactionId = xflowResult.transactionId;
      const qrCode = xflowResult.qrcode;

      if (!transactionId || !qrCode) {
        this.logger.error('[DepositService] ❌ Resposta incompleta da Xflow.');
        throw new BadRequestException('Erro ao gerar QR Code na adquirente.');
      }

      const uniqueToken = crypto.randomBytes(20).toString('hex');

      this.logger.log(`[DepositService] 💾 Salvando no banco de dados...`);

      const newDeposit = await this.prisma.deposit.create({
        data: {
          // ⚠️ Você usa externalId = transactionId da adquirente (mantive seu padrão)
          externalId: String(transactionId),
          amountInCents: dto.amount,
          netAmountInCents: dto.amount,
          status: 'PENDING',
          payerName,
          payerEmail: user.email,
          payerDocument: cleanDocument,
          webhookToken: uniqueToken,
          user: { connect: { id: userId } },
        },
      });

      this.logger.log(`[DepositService] ✅ SUCESSO TOTAL! ID: ${newDeposit.id}`);

      return {
        message: 'Deposit created successfully.',
        transactionId: String(transactionId),
        status: xflowResult.status || 'PENDING',
        qrcode: String(qrCode),
        amount: dto.amount,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(`[DepositService] ❌ ERRO: ${error.message}`);

      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }

      throw new BadRequestException(`Erro ao processar depósito: ${error.message}`);
    }
  }
}
