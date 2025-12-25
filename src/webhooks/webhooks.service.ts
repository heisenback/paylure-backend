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
    // XFlow manda 'transaction_id' ou 'external_id'
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

    this.logger.log(`🔍 Processando Webhook. Status: ${status} | IDs Possíveis: [${queryEid}, ${xflowId}]`);

    // --- BUSCA O DEPÓSITO ---
    
    // 🔥 CORREÇÃO DO ERRO DE BUILD: Tipagem explícita
    let deposit: Deposit | null = null;

    // Tentativa 1: Pelo External ID (Nosso UUID)
    if (queryEid) {
        deposit = await this.prisma.deposit.findUnique({ where: { externalId: queryEid } });
    }

    // Tentativa 2: Pelo Webhook Token (Onde salvamos o ID da XFlow)
    if (!deposit && xflowId) {
        deposit = await this.prisma.deposit.findUnique({ where: { webhookToken: String(xflowId) } });
    }

    // Se ainda não achou, pode ser que o xflowId seja o externalId (caso a XFlow devolva nosso ID)
    if (!deposit && xflowId) {
        deposit = await this.prisma.deposit.findUnique({ where: { externalId: String(xflowId) } });
    }

    if (!deposit) {
        this.logger.warn(`⚠️ Depósito não encontrado no banco de dados.`);
        return { received: true }; 
    }

    // --- LÓGICA DE APROVAÇÃO ---
    // Aceita COMPLETED, PAID ou APPROVED
    if (['COMPLETED', 'PAID', 'APPROVED', 'SUCCEEDED'].includes(status)) {
        
        if (deposit.status !== 'COMPLETED') {
            this.logger.log(`💰 Aprovando Depósito ${deposit.externalId}...`);

            await this.prisma.$transaction(async (tx) => {
                // 1. Atualiza Status do Depósito
                await tx.deposit.update({
                    where: { id: deposit!.id }, // Usa ! porque já checamos que deposit existe
                    data: { status: 'COMPLETED' },
                });
                
                // 2. Adiciona Saldo ao Usuário
                const updatedUser = await tx.user.update({
                    where: { id: deposit!.userId },
                    data: { balance: { increment: deposit!.amountInCents } },
                });

                // 3. Atualiza o Extrato (Transaction) para aparecer no Dash
                await tx.transaction.updateMany({
                    where: { 
                        // Atualiza pela referência externa OU interna para garantir
                        OR: [
                            { externalId: deposit!.externalId },
                            { referenceId: String(xflowId) }
                        ]
                    },
                    data: { status: 'COMPLETED' }
                });

                // 4. Notifica o Frontend (Socket) para atualizar a tela sem F5
                this.paymentGateway.notifyDepositConfirmed(deposit!.userId, {
                    amount: deposit!.amountInCents,
                    status: 'COMPLETED',
                    externalId: deposit!.externalId
                });
                
                this.paymentGateway.notifyBalanceUpdate(deposit!.userId, updatedUser.balance);
            });

            this.logger.log(`✅ SUCESSO: Saldo liberado para o usuário ${deposit.userId}`);
        } else {
            this.logger.log(`ℹ️ Depósito ${deposit.externalId} já estava pago. Ignorando duplicidade.`);
        }
    } 
    else if (status === 'FAILED' || status === 'CANCELED') {
        if (deposit.status === 'PENDING') {
             await this.prisma.deposit.update({
                where: { id: deposit.id },
                data: { status: 'FAILED' },
            });
            await this.prisma.transaction.updateMany({
                where: { externalId: deposit.externalId },
                data: { status: 'FAILED' }
            });
            this.logger.log(`❌ Depósito ${deposit.externalId} marcado como falho.`);
        }
    }

    return { received: true };
  }

  async handleKeyclubWebhook(payload: any) {
    return this.handleXflowWebhook(payload);
  }
}