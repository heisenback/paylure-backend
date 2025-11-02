// src/webhooks/webhooks.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly KEY_CLUB_WEBHOOK_SECRET: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.KEY_CLUB_WEBHOOK_SECRET = this.configService.get<string>(
      'KEY_CLUB_WEBHOOK_SECRET',
    )!;
    if (!this.KEY_CLUB_WEBHOOK_SECRET) {
      this.logger.error('KEY_CLUB_WEBHOOK_SECRET não definido no .env!');
    }
  }

  validateSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.KEY_CLUB_WEBHOOK_SECRET || !signature) {
      this.logger.warn('Webhook recebido sem segredo ou assinatura.');
      return false;
    }

    try {
      const hmac = crypto.createHmac(
        'sha256',
        this.KEY_CLUB_WEBHOOK_SECRET,
      );

      hmac.update(rawBody);

      const digest = hmac.digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(signature),
      );
    } catch (e) {
      this.logger.error('Erro ao validar assinatura', e);
      return false;
    }
  }

  /**
   * Processa o evento de depósito da KeyClub.
   */
  async handleKeyClubDeposit(token: string, payload: any) {
    const status = (payload.status || '').toUpperCase();
    this.logger.log(
      `Webhook recebido para o token: ${token} | Status: ${status}`,
    );

    // 1. Encontrar o depósito no banco usando o token único
    const deposit = await this.prisma.deposit.findUnique({
      where: { webhookToken: token },
      include: { user: true },
    });

    if (!deposit) {
      this.logger.error(`Depósito com token ${token} não encontrado.`);
      throw new NotFoundException('Depósito não encontrado.');
    }

    // 2. Se o depósito já foi pago, não faz nada
    if (deposit.status === 'PAID') {
      this.logger.log(`Depósito ${deposit.id} já estava PAGO.`);
      return { success: true, message: 'Depósito já processado.' };
    }

    // 3. Se o pagamento foi COMPLETO ou APROVADO
    if (status === 'COMPLETED' || status === 'APPROVED') {
      const payloadAmount = parseFloat(payload.data?.amount || payload.amount);
      
      // Validação do valor em BRL (KeyClub envia em BRL)
      const depositAmountBRL = deposit.amountInCents / 100;

      if (
        !isNaN(payloadAmount) &&
        Math.abs(payloadAmount - depositAmountBRL) > 0.01
      ) {
        this.logger.error(
          `Valor do webhook (${payloadAmount}) não bate com o do depósito (${depositAmountBRL})!`,
        );
        throw new BadRequestException('Valor do depósito não confere.');
      }

      // 4. ATUALIZAR O SALDO DO USUÁRIO (Usamos o valor em CENTAVOS do DB)
      // O valor já está em CENTAVOS no campo deposit.amountInCents
      const amountInCents = deposit.amountInCents; 

      await this.prisma.$transaction([
        // Operação 1: Atualiza o status do Depósito
        this.prisma.deposit.update({
          where: { id: deposit.id },
          data: { status: 'PAID' },
        }),

        // Operação 2: Incrementa o saldo no modelo User
        this.prisma.user.update({
          where: { id: deposit.userId }, 
          data: {
            balance: {
              increment: amountInCents,
            },
          },
        }),
      ]);

      // CORREÇÃO DE LOG:
      this.logger.log(
        `[SUCESSO] Saldo do Usuário ${deposit.user.name} (ID: ${deposit.userId}) atualizado em +${amountInCents} centavos.`,
      );
      return {
        success: true,
        message: 'Pagamento recebido e saldo atualizado!',
      };
      
    } else if (['CANCELED', 'REFUNDED', 'FAILED'].includes(status)) {
      // 5. Se o PIX foi cancelado ou falhou
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: status.toUpperCase() },
      });
      this.logger.warn(`Depósito ${deposit.id} marcado como ${status}.`);
      return { success: true, message: `Status ${status} registrado.` };
    }

    return { success: true, message: 'Status não requer ação.' };
  }
}