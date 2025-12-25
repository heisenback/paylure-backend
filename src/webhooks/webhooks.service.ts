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

  async handleXflowWebhook(payload: any, queryEid?: string) {
    // ID que vem no corpo do webhook (geralmente é o ID da XFlow)
    const xflowId = payload.transaction_id || payload.external_id;
    // Nosso ID que tentamos passar na URL
    const ourId = queryEid;
    
    const status = String(payload.status || '').toUpperCase();

    this.logger.log(`🔍 Webhook XFlow: ID Externo=${xflowId} | Nosso ID=${ourId} | Status=${status}`);

    if (!xflowId && !ourId) {
        this.logger.warn('⚠️ Webhook ignorado: Nenhum ID encontrado.');
        return { received: true };
    }

    // 1. Tenta achar pelo nosso ID (externalId)
    let deposit = null;
    if (ourId) {
        deposit = await this.prisma.deposit.findUnique({ where: { externalId: ourId } });
    }

    // 2. Se não achou, tenta achar pelo ID da XFlow (salvo no webhookToken)
    if (!deposit && xflowId) {
        deposit = await this.prisma.deposit.findUnique({ where: { webhookToken: String(xflowId) } });
    }

    if (!deposit) {
        this.logger.warn(`⚠️ Depósito não encontrado no banco. (XFlow ID: ${xflowId})`);
        // Retornamos 200 para a XFlow não ficar reenviando, pois o erro é nosso de não ter achado
        return { received: true }; 
    }

    // --- PROCESSAR PAGAMENTO ---
    if (status === 'COMPLETED' || status === 'PAID') {
        if (deposit.status !== 'COMPLETED') {
            await this.prisma.$transaction(async (tx) => {
                // Atualiza status do depósito
                await tx.deposit.update({
                    where: { id: deposit.id },
                    data: { status: 'COMPLETED' },
                });
                
                // Credita saldo ao usuário
                const updatedUser = await tx.user.update({
                    where: { id: deposit.userId },
                    data: { balance: { increment: deposit.amountInCents } },
                });

                // Atualiza o extrato (Transaction)
                // Tenta achar pela externalId ou pela referenceId (XFlow ID)
                await tx.transaction.updateMany({
                    where: { 
                        OR: [
                            { externalId: deposit.externalId },
                            { referenceId: String(xflowId) }
                        ]
                    },
                    data: { status: 'COMPLETED' }
                });

                // Notifica o Frontend via Socket
                this.paymentGateway.notifyDepositConfirmed(deposit.userId, {
                    amount: deposit.amountInCents,
                    status: 'COMPLETED'
                });
                this.paymentGateway.notifyBalanceUpdate(deposit.userId, updatedUser.balance);
            });
            this.logger.log(`✅ Pagamento aprovado! R$ ${(deposit.amountInCents/100).toFixed(2)} creditados para usuário ${deposit.userId}`);
        } else {
            this.logger.log(`ℹ️ Depósito ${deposit.externalId} já estava pago. Ignorando duplicidade.`);
        }
    }

    return { received: true };
  }

  async handleKeyclubWebhook(payload: any) {
    return this.handleXflowWebhook(payload);
  }
}