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
    
    // Este é o NOSSO ID (que enviamos para a XFlow)
    const externalId = crypto.randomUUID();
    const webhookToken = crypto.randomBytes(20).toString('hex');

    const payerName = dto.payerName || user.name || 'Cliente Paylure';
    const payerEmail = dto.payerEmail || user.email;
    const payerDocument = dto.payerDocument || user.document || '00000000000';

    try {
      this.logger.log(`🚀 Iniciando depósito para ${payerName}`);

      // Chama a XFlow
      const xflowResult = await this.xflow.createDeposit({
        amount: dto.amount / 100,
        externalId: externalId,
        payerName: payerName,
        payerEmail: payerEmail,
        payerDocument: payerDocument,
      });

      // Se a XFlow retornou um ID dela, usamos ele como referência secundária
      // Mas o externalId principal continua sendo o nosso UUID
      const xflowTransactionId = xflowResult.transactionId;

      await this.prisma.$transaction(async (tx) => {
        // Cria Depósito
        await tx.deposit.create({
          data: {
            externalId: externalId, // Nosso ID (usado na URL do webhook ?eid=...)
            amountInCents: dto.amount,
            netAmountInCents: dto.amount,
            status: 'PENDING',
            payerName: payerName,
            payerEmail: payerEmail,
            payerDocument: payerDocument,
            webhookToken: webhookToken, // Pode ser usado para guardar o ID da XFlow se quiser
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
            referenceId: xflowTransactionId, // 🔥 Salvamos o ID da XFlow aqui para referência
            paymentMethod: 'PIX',
            pixQrCode: xflowResult.qrcode, 
            pixCopyPaste: xflowResult.qrcode,
          }
        });
      });

      this.logger.log(`✅ Depósito ${externalId} criado. XFlow ID: ${xflowTransactionId}`);

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