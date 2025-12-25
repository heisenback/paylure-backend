import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async handleXflowWebhook(payload: any, queryExternalId?: string) {
    // Tenta pegar o ID de várias fontes para garantir
    const externalId = queryExternalId || payload.external_id || payload.transaction_id;
    const status = String(payload.status || '').toUpperCase();

    this.logger.log(`🌊 XFlow Webhook: ID ${externalId} | Status: ${status}`);

    if (!externalId) return { error: 'No external ID found' };

    // --- 1. TENTA ACHAR UM DEPÓSITO ---
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(externalId) },
    });

    if (deposit) {
      if (deposit.status === 'COMPLETED') return { message: 'Already completed' };

      if (status === 'COMPLETED') {
        await this.prisma.$transaction(async (tx) => {
          // Atualiza status
          await tx.deposit.update({
            where: { id: deposit.id },
            data: { status: 'COMPLETED' },
          });

          // Credita saldo
          const updatedUser = await tx.user.update({
            where: { id: deposit.userId },
            data: { balance: { increment: deposit.amountInCents } },
          });

          // Notifica Socket
          this.paymentGateway.notifyDepositConfirmed(deposit.userId, {
             externalId: deposit.externalId,
             status: 'COMPLETED',
             amount: deposit.amountInCents
          });
          this.paymentGateway.notifyBalanceUpdate(deposit.userId, updatedUser.balance);
        });
        this.logger.log(`✅ Depósito ${externalId} confirmado.`);
      } else if (status === 'FAILED') {
          await this.prisma.deposit.update({
            where: { id: deposit.id },
            data: { status: 'FAILED' },
          });
      }
      return { received: true, type: 'DEPOSIT' };
    }

    // --- 2. TENTA ACHAR UM SAQUE (Se não for depósito) ---
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { externalId: String(externalId) },
    });

    if (withdrawal) {
        if (withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED') return { message: 'Already processed' };

        if (status === 'COMPLETED') {
            await this.prisma.withdrawal.update({
                where: { id: withdrawal.id },
                data: { status: 'COMPLETED' },
            });
            
            this.paymentGateway.notifyWithdrawalProcessed(withdrawal.userId, {
                externalId, status: 'COMPLETED'
            });
            this.logger.log(`✅ Saque ${externalId} confirmado (dinheiro enviado).`);
        } 
        else if (status === 'FAILED' || status === 'RETIDO') {
            // Estorno Automático
            await this.prisma.$transaction(async (tx) => {
                await tx.withdrawal.update({
                    where: { id: withdrawal.id },
                    data: { status: 'FAILED', failureReason: 'Recusado pela adquirente' },
                });
                
                // Devolve o dinheiro
                const updatedUser = await tx.user.update({
                    where: { id: withdrawal.userId },
                    data: { balance: { increment: withdrawal.amount } },
                });

                this.paymentGateway.notifyBalanceUpdate(withdrawal.userId, updatedUser.balance);
            });
            this.logger.log(`↩️ Saque ${externalId} falhou. Saldo estornado.`);
        }
        return { received: true, type: 'WITHDRAWAL' };
    }

    this.logger.warn(`⚠️ Webhook recebido mas ID ${externalId} não encontrado em Depósitos nem Saques.`);
    return { received: true, status: 'NOT_FOUND' };
  }

  // Mantido para compatibilidade se ainda receber chamadas antigas
  async handleKeyclubWebhook(payload: any) {
    this.logger.warn('⚠️ Webhook Keyclub recebido (Descontinuado).');
    return { received: true };
  }
}