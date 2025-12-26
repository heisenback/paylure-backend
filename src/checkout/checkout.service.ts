import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { XflowService } from 'src/xflow/xflow.service'; // ✅ Trocado Keyclub por Xflow
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as crypto from 'crypto';
import { User } from '@prisma/client';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xflowService: XflowService, // ✅ Injeção da Xflow
  ) {}

  private onlyDigits(v?: string) {
    return (v || '').replace(/\D/g, '');
  }

  async processCheckout(dto: CreatePaymentDto) {
    // 1) Busca Produto e Vendedor
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { merchant: { include: { user: true } } },
    });

    if (!product) throw new NotFoundException('Produto não encontrado.');
    if (!product.merchant?.user) throw new BadRequestException('Vendedor inválido.');

    const sellerUser = product.merchant.user;

    const cleanItems =
      dto.items?.map((item) => ({
        ...item,
        title: item.title || product.name,
      })) || [];

    // 2) Calcula Valor Total (produto + offer + bumps)
    let totalAmountInCents = Number(product.priceInCents);

    if (dto.offerId) {
      const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId } });
      if (offer) totalAmountInCents = offer.priceInCents;
    }

    if (cleanItems.length > 0) {
      const bumpsTotal = cleanItems
        .filter((item) => item.id !== product.id)
        .reduce((acc, item) => acc + item.price, 0);
      totalAmountInCents += bumpsTotal;
    }

    if (totalAmountInCents < 100) throw new BadRequestException('Valor mínimo R$ 1,00.');

    // 3) Resolve afiliado (ref)
    let affiliateId: string | null = null;
    let affiliateUser: User | null = null;
    let commissionRate = 0;

    if (dto.ref) {
      const mpProduct = await this.prisma.marketplaceProduct.findUnique({
        where: { productId: product.id },
      });

      if (mpProduct) {
        const affiliation = await this.prisma.affiliate.findUnique({
          where: {
            promoterId_marketplaceProductId: {
              promoterId: dto.ref,
              marketplaceProductId: mpProduct.id,
            },
          },
        });

        const requiresApproval = product.affiliationType === 'APPROVAL';

        if (
          affiliation &&
          (affiliation.status === 'APPROVED' || (!requiresApproval && affiliation.status !== 'REJECTED'))
        ) {
          affiliateId = dto.ref;
          commissionRate = mpProduct.commissionRate || product.commissionPercent || 0;

          affiliateUser = await this.prisma.user.findUnique({
            where: { id: affiliateId },
          });

          this.logger.log(
            `✅ Venda com afiliado: ${affiliateUser?.email || affiliateId} | Comissão: ${commissionRate}%`,
          );
        } else {
          this.logger.warn(`⚠️ ref ignorado ou inválido: ${dto.ref}`);
        }
      }
    }

    // 4) Documento/Telefone
    let finalDocument = this.onlyDigits(dto.customer.document);
    let finalPhone = this.onlyDigits(dto.customer.phone) || '11999999999';

    if (!finalDocument || finalDocument.length < 11) {
      if (affiliateUser?.document) {
        finalDocument = this.onlyDigits(affiliateUser.document);
      } else {
        finalDocument =
          this.onlyDigits(sellerUser.document || '') ||
          this.onlyDigits(product.merchant.cnpj || '') ||
          '00000000000';
      }
    }

    if (!finalDocument || finalDocument.length < 11) finalDocument = '00000000000';

    // 5) IDs e valores
    const externalId = `chk_${crypto.randomUUID()}`; // Nosso ID interno
    const amountInBRL = totalAmountInCents / 100;

    // 6) Congela split (snapshot para uso interno)
    const affiliateAmountInCents =
      affiliateId && commissionRate > 0
        ? Math.round(totalAmountInCents * (commissionRate / 100))
        : 0;

    const sellerAmountInCents = totalAmountInCents - affiliateAmountInCents;

    if (sellerAmountInCents < 0) {
      throw new BadRequestException('Split inválido: comissão maior que o total.');
    }

    try {
      this.logger.log(`🚀 Iniciando Checkout XFlow: ${product.name} - R$ ${amountInBRL}`);

      // 7) Cria depósito na XFlow (Adquirente)
      // Nota: A XFlow cobra o valor cheio. O split (afiliado) é feito internamente no nosso banco.
      const xflowResult = await this.xflowService.createDeposit({
        amount: amountInBRL,
        externalId: externalId,
        payerName: dto.customer.name,
        payerEmail: dto.customer.email,
        payerDocument: finalDocument,
      });

      // ID da transação na XFlow (importante para o Webhook)
      const xflowTransactionId = xflowResult.transactionId;

      // 8) Salva Depósito no Banco
      await this.prisma.deposit.create({
        data: {
          id: externalId, // Usamos nosso ID gerado
          externalId: externalId,
          amountInCents: totalAmountInCents,
          netAmountInCents: sellerAmountInCents, // O que vai pro saldo do produtor
          status: 'PENDING',
          payerName: dto.customer.name,
          payerEmail: dto.customer.email,
          payerDocument: finalDocument,
          // 🔥 IMPORTANTE: Salvamos o ID da XFlow aqui para o Webhook encontrar depois
          webhookToken: xflowTransactionId || 'PENDING', 
          userId: sellerUser.id,
          merchantId: product.merchant.id,
        } as any,
      });

      // 9) Transação do produtor (Extrato)
      await this.prisma.transaction.create({
        data: {
          id: externalId,
          amount: sellerAmountInCents, // Valor líquido do produtor
          status: 'PENDING',
          type: 'SALE',
          paymentMethod: 'PIX',
          description: `Venda: ${product.name}`,
          userId: sellerUser.id,
          productId: product.id,
          customerName: dto.customer.name,
          customerEmail: dto.customer.email,
          customerDoc: finalDocument,
          customerPhone: finalPhone,
          externalId: externalId, // Nosso ID
          referenceId: xflowTransactionId, // Link com a XFlow
          pixQrCode: xflowResult.qrcode,
          pixCopyPaste: xflowResult.qrcode,
          metadata: {
            ref: affiliateId,
            refRaw: dto.ref,
            offerId: dto.offerId,
            items: cleanItems,
            commissionRate,
            grossAmount: totalAmountInCents,
            affiliateAmount: affiliateAmountInCents,
            sellerAmount: sellerAmountInCents,
          } as any,
        },
      });

      // 10) Transação do afiliado (Comissão Pendente)
      if (affiliateId && affiliateAmountInCents > 0) {
        await this.prisma.transaction.create({
          data: {
            id: `${externalId}_aff`,
            amount: affiliateAmountInCents,
            status: 'PENDING',
            type: 'COMMISSION',
            paymentMethod: 'PIX',
            description: `Comissão de Afiliado: ${product.name} (${commissionRate}%)`,
            userId: affiliateId,
            productId: product.id,
            customerName: dto.customer.name,
            customerEmail: dto.customer.email,
            externalId: externalId, // Amarrado à venda principal
            referenceId: xflowTransactionId,
            metadata: {
              isAffiliateCommission: true,
              originalTransactionId: externalId,
              sellerId: sellerUser.id,
              commissionRate,
              grossAmount: totalAmountInCents,
            } as any,
          },
        });

        this.logger.log(
          `✅ Comissão registrada: R$ ${(affiliateAmountInCents / 100).toFixed(2)} para afiliado ${affiliateId}`,
        );
      }

      return {
        success: true,
        pix: {
          qrCode: xflowResult.qrcode,
          copyPaste: xflowResult.qrcode,
          transactionId: externalId, // Retorna nosso ID para o front fazer polling
        },
      };
    } catch (error: any) {
      this.logger.error(`Checkout Error: ${error.message}`);
      throw new BadRequestException('Erro ao gerar PIX. Tente novamente.');
    }
  }

  async checkTransactionStatus(id: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [{ externalId: id }, { referenceId: id }, { id: id }],
      },
      select: { status: true },
    });
    return { status: tx?.status || 'PENDING' };
  }
}