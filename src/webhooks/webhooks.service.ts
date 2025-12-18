// src/webhooks/webhooks.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from '../gateway/payment.gateway';
import { MailService } from '../mail/mail.service'; // ✅ IMPORTADO

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGateway,
    private readonly mailService: MailService, // ✅ INJETADO
  ) {}

  async handleKeyclubWebhook(payload: any) {
    this.logger.log(`🔥 [Webhook] Payload recebido`);

    const transactionId =
      payload.transaction_id ||
      payload.id ||
      payload.transactionId ||
      payload.external_id;

    const rawStatus = payload.status || payload.payment_status || '';
    const status = String(rawStatus).toUpperCase();

    if (!transactionId) {
      throw new NotFoundException('transaction_id required');
    }

    // 1️⃣ Busca depósito
    const deposit = await this.prisma.deposit.findUnique({
      where: { externalId: String(transactionId) },
    });

    if (!deposit) {
      this.logger.error(`❌ Depósito não encontrado: ${transactionId}`);
      throw new NotFoundException('Depósito não encontrado');
    }

    // 2️⃣ Idempotência
    if (deposit.status === 'CONFIRMED' || deposit.status === 'PAID') {
      return { message: 'Already processed' };
    }

    const approvedStatuses = [
      'PAID',
      'COMPLETED',
      'APPROVED',
      'SUCCEEDED',
      'CONFIRMED',
    ];

    if (!approvedStatuses.includes(status)) {
      return { message: `Status ignored: ${status}` };
    }

    // 3️⃣ Busca TODAS as transações criadas no checkout
    const transactions = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { externalId: deposit.externalId },
          { referenceId: deposit.id },
          { referenceId: deposit.externalId },
        ],
        status: 'PENDING',
      },
    });

    if (transactions.length === 0) {
      this.logger.warn(`⚠️ Nenhuma transação pendente para ${deposit.externalId}`);
    }

    // 4️⃣ Executa tudo atomicamente (SPLIT E CONFIRMAÇÃO)
    await this.prisma.$transaction(async (tx) => {
      // A. Confirma depósito
      await tx.deposit.update({
        where: { id: deposit.id },
        data: { status: 'CONFIRMED' },
      });

      // B. Confirma e credita cada transação
      for (const transaction of transactions) {
        // 1. Atualiza status da transação
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'COMPLETED' },
        });

        // 2. Lógica de Co-produção (Split)
        let producerAmount = transaction.amount;
        let coProducerAmount = 0;

        if (transaction.productId) {
          const product = await tx.product.findUnique({ where: { id: transaction.productId } });
          
          // Verifica se tem co-produção configurada e ativa
          if (product && product.coproductionEmail && product.coproductionPercent > 0) {
             const coProducer = await tx.user.findUnique({ where: { email: product.coproductionEmail } });
             
             if (coProducer) {
                // Calcula valores
                coProducerAmount = Math.floor(transaction.amount * (product.coproductionPercent / 100));
                producerAmount = transaction.amount - coProducerAmount;

                // Credita Co-produtor
                await tx.user.update({
                    where: { id: coProducer.id },
                    data: { balance: { increment: coProducerAmount } }
                });

                // Cria extrato para Co-produtor
                await tx.transaction.create({
                    data: {
                        userId: coProducer.id,
                        productId: product.id,
                        type: 'COPRODUCTION',
                        amount: coProducerAmount,
                        status: 'COMPLETED',
                        description: `Co-produção: ${product.name}`,
                        customerEmail: transaction.customerEmail,
                        referenceId: transaction.id
                    }
                });

                this.logger.log(`💰 Split realizado: Produtor ${producerAmount} / Co-produtor ${coProducerAmount}`);
             } else {
                this.logger.warn(`⚠️ Co-produtor (${product.coproductionEmail}) não encontrado. Valor total para o produtor.`);
             }
          }
        }

        // 3. Credita o Produtor (Valor total ou o restante do split)
        await tx.user.update({
          where: { id: transaction.userId },
          data: {
            balance: { increment: producerAmount },
          },
        });
      }
    });

    // 5️⃣ Notificações e Emails
    try {
      for (const transaction of transactions) {
        const freshUser = await this.prisma.user.findUnique({
          where: { id: transaction.userId },
        });

        if (freshUser) {
          // A. Enviar Socket (Tempo Real)
          this.paymentGateway.emitToUser(transaction.userId, 'balance_updated', {
            balance: freshUser.balance || 0,
          });

          this.paymentGateway.emitToUser(transaction.userId, 'transaction_completed', {
            amount: transaction.amount,
            type: transaction.type,
            productId: transaction.productId,
          });

          // B. Enviar Email de Acesso / Boas-vindas (NOVO) ✅
          const accessLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
          const productName = 'Conteúdo Premium'; 

          await this.mailService.sendAccessEmail(
            freshUser.email,
            productName,
            accessLink,
          );
        }
      }
    } catch (e) {
      this.logger.warn(`⚠️ Erro ao processar notificações: ${e.message}`);
    }

    this.logger.log(`✅ Webhook processado com sucesso`);
    return { message: 'Confirmed successfully' };
  }
}