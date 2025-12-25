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
    
    const externalId = crypto.randomUUID();
    const webhookToken = crypto.randomBytes(20).toString('hex');

    try {
      const xflowResult = await this.xflow.createDeposit({
        amount: dto.amount / 100,
        externalId: externalId,
        payerName: user.name || 'Cliente',
        payerEmail: user.email,
        payerDocument: dto.payerDocument || '00000000000',
      });

      const deposit = await this.prisma.deposit.create({
        data: {
          externalId: externalId,
          amountInCents: dto.amount,
          netAmountInCents: dto.amount,
          status: 'PENDING',
          payerName: user.name || 'Cliente',
          payerEmail: user.email,
          payerDocument: dto.payerDocument || '00000000000',
          webhookToken: webhookToken,
          user: { connect: { id: userId } },
        },
      });

      return {
        transactionId: externalId,
        qrcode: xflowResult.qrcode,
        status: 'PENDING',
        amount: dto.amount,
        message: 'Depósito criado com sucesso.'
      };
    } catch (err: any) {
      throw new BadRequestException('Erro ao gerar pagamento.');
    }
  }
}