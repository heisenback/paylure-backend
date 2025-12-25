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

    // 1. Busca dados completos do usuário para enviar à XFlow
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    const externalId = crypto.randomUUID();
    const webhookToken = crypto.randomBytes(20).toString('hex');

    // Prioriza os dados do DTO (Front), senão usa do Banco, senão usa padrão
    const payerName = dto.payerName || user.name || 'Cliente Paylure';
    const payerEmail = dto.payerEmail || user.email;
    const payerDocument = dto.payerDocument || user.document || '00000000000';

    try {
      this.logger.log(`🚀 Iniciando depósito para ${payerName} (Doc: ${payerDocument})`);

      // 2. Chama a XFlow
      const xflowResult = await this.xflow.createDeposit({
        amount: dto.amount / 100, // Envia em Reais (Float)
        externalId: externalId,
        payerName: payerName,
        payerEmail: payerEmail,
        payerDocument: payerDocument,
      });

      // 3. Transação de Banco de Dados (Atomicidade)
      await this.prisma.$transaction(async (tx) => {
        // A) Cria na tabela específica de Depósitos
        await tx.deposit.create({
          data: {
            externalId: externalId,
            amountInCents: dto.amount,
            netAmountInCents: dto.amount,
            status: 'PENDING',
            payerName: payerName,
            payerEmail: payerEmail,
            payerDocument: payerDocument,
            webhookToken: webhookToken,
            user: { connect: { id: userId } },
          },
        });

        // B) CORREÇÃO: Cria na tabela de Extrato (Transactions) para aparecer no Dash
        await tx.transaction.create({
          data: {
            userId: userId,
            type: 'DEPOSIT',
            amount: dto.amount,
            status: 'PENDING',
            description: 'Depósito via PIX',
            externalId: externalId,
            paymentMethod: 'PIX',
            pixQrCode: xflowResult.qrcode, // Salva o QR Code no banco para consulta futura
            pixCopyPaste: xflowResult.qrcode,
          }
        });
      });

      this.logger.log(`✅ Depósito registrado e QR Code gerado: ${externalId}`);

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