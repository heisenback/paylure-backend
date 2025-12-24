// src/deposit/deposit.service.ts
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

  async createDeposit(userId: string, dto: { amount: number; payerDocument: string }) {
    // Validação: valor vem em centavos do front (ex: 1000 = R$ 10,00)
    if (!dto.amount || dto.amount < 100) {
      throw new BadRequestException('Valor mínimo de depósito é R$ 1,00');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado');

    const externalId = crypto.randomUUID();

    try {
      // Chama Xflow (valor convertido para Reais)
      const xflowResult = await this.xflow.createDeposit({
        amount: dto.amount / 100,
        externalId: externalId,
        payerName: user.name || 'Cliente',
        payerEmail: user.email,
        payerDocument: dto.payerDocument || '00000000000',
      });

      // Salva no seu Banco de Dados
      const deposit = await this.prisma.deposit.create({
        data: {
          externalId: externalId,
          amountInCents: dto.amount,
          netAmountInCents: dto.amount,
          status: 'PENDING',
          payerName: user.name || 'Cliente',
          payerEmail: user.email,
          payerDocument: dto.payerDocument,
          user: { connect: { id: userId } },
        },
      });

      return {
        transactionId: externalId,
        qrcode: xflowResult.qrcode,
        status: 'PENDING',
        amount: dto.amount,
      };
    } catch (err: any) {
      this.logger.error(`❌ Falha no depósito: ${err.message}`);
      throw new BadRequestException(err.message || 'Erro ao gerar pagamento.');
    }
  }
}