import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';
import { Deposit } from '@prisma/client'; // ✅ Importação necessária para a tipagem

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async handleXflowWebhook(payload: any, queryEid?: string) {
    // 1. Identificação do ID
    // XFlow manda 'transaction_id' ou 'external_id' ou 'id'
    const xflowId = payload.transaction_id || payload.id || payload.external_id;
    const status = String(payload.status || '').toUpperCase();

    // Prioridade de busca:
    // 1. Pelo ID interno que passamos na URL (?eid=...)
    // 2. Pelo ID da transação da XFlow que salvamos no campo webhookToken
    const searchId = queryEid || xflowId;

    if (!searchId) {
        this.logger.warn('⚠️ Webhook ignorado: Payload sem ID identificável.');
        return { received: true };
    }

    this.logger.log(`🔍 Processando Webhook. Status: ${status} | IDs: [${queryEid}, ${xflowId}]`);

    // 2. Busca o Depósito no Banco
    let deposit: Deposit | null = null;

    // Tentativa A: Pelo ID interno (External ID) vindo da URL
    if (queryEid) {
        deposit = await this.prisma.deposit.findUnique({ where: { externalId: queryEid } });
    }

    // Tentativa B: Pelo ID da XFlow (Webhook Token - Onde salvamos o ID da XFlow no checkout/deposito)
    if (!deposit && xflowId) {
        deposit = await this.prisma.deposit.findUnique({ where: { webhookToken: String(xflowId) } });
    }

    // Tentativa C: Fallback - Pelo ID da XFlow no campo External ID (caso raro onde usamos o ID deles como nosso)
    if (!deposit && xflowId) {
        deposit = await this.prisma.deposit.findUnique({ where: { externalId: String(xflowId) } });
    }

    if (!deposit) {
        this.logger.warn(`⚠️ Depósito não encontrado no banco. (XFlow ID: ${xflowId})`);
        // Retornamos 200 para a XFlow não ficar reenviando, pois o erro é nosso de não ter o registro
        return { received: true }; 
    }

    // 3. Processamento de Status
    // Aceita vários status de sucesso para garantir compatibilidade
    const isApproved = ['COMPLETED', 'PAID', 'APPROVED', 'SUCCEEDED'].includes(status);
    const isFailed = ['FAILED', 'REJECTED', 'CANCELED'].includes(status);

    if (isApproved) {
        
        if (deposit.status !== 'COMPLETED') {
            this.logger.log(`💰 Aprovando Transação ${deposit.externalId}...`);

            await this.prisma.$transaction(async (tx) => {
                // A) Atualiza o Depósito Principal
                await tx.deposit.update({
                    where: { id: deposit!.id },
                    data: { status: 'COMPLETED' },
                });
                
                // B) Credita o Saldo (CORREÇÃO CRÍTICA AQUI)
                // Verifica se existe um 'netAmountInCents' (Valor Líquido) maior que zero.
                // - No Checkout: netAmount é o valor descontado taxas/afiliados.
                // - No Dashboard (Depósito): netAmount geralmente é igual ao amount.
                const creditAmount = (deposit!.netAmountInCents && deposit!.netAmountInCents > 0) 
                    ? deposit!.netAmountInCents 
                    : deposit!.amountInCents;

                const updatedUser = await tx.user.update({
                    where: { id: deposit!.userId },
                    data: { balance: { increment: creditAmount } },
                });

                // C) Atualiza TODAS as transações relacionadas no Extrato
                // - A Venda Principal tem externalId = deposit.externalId
                // - A Comissão de Afiliado tem referenceId = deposit.externalId (vinculada à venda)
                // - Fallback para referenceId = xflowId
                await tx.transaction.updateMany({
                    where: { 
                        OR: [
                            { externalId: deposit!.externalId }, // Venda do Produtor / Depósito
                            { referenceId: deposit!.externalId }, // Comissão do Afiliado
                            { referenceId: String(xflowId) }      // Fallback
                        ]
                    },
                    data: { status: 'COMPLETED' }
                });

                // D) Notificações em Tempo Real (Socket)
                // Notifica que o depósito/venda foi confirmado com o valor real creditado
                this.paymentGateway.notifyDepositConfirmed(deposit!.userId, {
                    amount: creditAmount, 
                    status: 'COMPLETED',
                    externalId: deposit!.externalId
                });
                
                // Atualiza o saldo na tela do usuário instantaneamente
                this.paymentGateway.notifyBalanceUpdate(deposit!.userId, updatedUser.balance);
            });

            const amountBrl = ((deposit.netAmountInCents > 0 ? deposit.netAmountInCents : deposit.amountInCents) / 100).toFixed(2);
            this.logger.log(`✅ SUCESSO: R$ ${amountBrl} creditados na conta do usuário.`);
        } else {
            this.logger.log(`ℹ️ Transação ${deposit.externalId} já estava paga. Ignorando duplicidade.`);
        }
    } 
    else if (isFailed && deposit.status === 'PENDING') {
         await this.prisma.deposit.update({
            where: { id: deposit.id },
            data: { status: 'FAILED' },
        });
        // Reprova venda e comissões associadas no extrato
        await this.prisma.transaction.updateMany({
            where: { 
                OR: [
                    { externalId: deposit.externalId },
                    { referenceId: deposit.externalId } 
                ]
            },
            data: { status: 'FAILED' }
        });
        this.logger.log(`❌ Transação ${deposit.externalId} marcada como falha.`);
    }

    return { received: true };
  }

  async handleKeyclubWebhook(payload: any) {
    return this.handleXflowWebhook(payload);
  }
}