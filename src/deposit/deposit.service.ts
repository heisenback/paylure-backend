import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { XflowService } from '../xflow/xflow.service';
import * as crypto from 'crypto';

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    private readonly xflow: XflowService,
    private readonly prisma: PrismaService,
  ) {}

  async createDeposit(userId: string, dto: any) {
    if (!dto.amount || dto.amount < 100) {
      throw new BadRequestException('Valor mínimo de depósito é R$ 1,00');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    // Nosso ID interno
    const externalId = crypto.randomUUID();

    const payerName = dto.payerName || user.name || 'Cliente Paylure';
    const payerEmail = dto.payerEmail || user.email;
    const payerDocument = dto.payerDocument || user.document || '00000000000';

    try {
      this.logger.log(`🚀 Iniciando depósito para ${payerName}`);

      // 1. Gera o PIX na XFlow
      const xflowResult = await this.xflow.createDeposit({
        amount: dto.amount / 100,
        externalId: externalId,
        payerName: payerName,
        payerEmail: payerEmail,
        payerDocument: payerDocument,
      });

      // Pega o ID da XFlow que veio da correção acima
      const xflowId = xflowResult.transactionId;

      // 2. Salva no Banco
      await this.prisma.$transaction(async (tx) => {
        // Cria Depósito
        await tx.deposit.create({
          data: {
            externalId: externalId,
            amountInCents: dto.amount,
            netAmountInCents: dto.amount,
            status: 'PENDING',
            payerName: payerName,
            payerEmail: payerEmail,
            payerDocument: payerDocument,
            // 🔥 O PULO DO GATO: Salvamos o ID da XFlow aqui para encontrar depois no webhook
            webhookToken: xflowId || 'PENDING', 
            user: { connect: { id: userId } },
          },
        });

        // Cria Transação no Extrato
        await tx.transaction.create({
          data: {
            userId: userId,
            type: 'DEPOSIT',
            amount: dto.amount,
            status: 'PENDING',
            description: 'Depósito via PIX',
            externalId: externalId,
            referenceId: xflowId, // Salva também no extrato
            paymentMethod: 'PIX',
            pixQrCode: xflowResult.qrcode, 
            pixCopyPaste: xflowResult.qrcode,
          }
        });
      });

      this.logger.log(`✅ Depósito ${externalId} criado. Linkado ao XFlow ID: ${xflowId}`);

      return {
        transactionId: externalId,
        qrcode: xflowResult.qrcode,
        status: 'PENDING',
        amount: dto.amount,
        message: 'Depósito criado com sucesso.'
      };
    } catch (err: any) {
      this.logger.error(`❌ Erro no DepositService: ${err.message}`);
      throw new BadRequestException('Erro ao gerar pagamento na adquirente.');
    }
  }
}