// src/checkout/checkout.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import * as crypto from 'crypto';
import { User } from '@prisma/client';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
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

    // OBS: aqui você está tratando dto.ref como ID do user do afiliado.
    // Se o seu ref for um "código" (slug), depois a gente adapta quando você mandar affiliate.service.ts / payment-link.service.ts.
    if (dto.ref) {
      // Só tenta se existir marketplaceProduct (produto no marketplace)
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

        // Regra: se for APPROVAL, precisa estar aprovado.
        // Se for OPEN, pode aceitar mesmo sem registro aprovado (depende do seu model),
        // mas como seu banco parece registrar afiliados, mantive seguro.
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
          this.logger.warn(
            `⚠️ ref recebido (${dto.ref}) mas afiliação não aprovada/válida para este produto (affiliationType=${product.affiliationType}).`,
          );
        }
      } else {
        this.logger.warn(`⚠️ Produto ${product.id} não possui marketplaceProduct. ref ignorado.`);
      }
    }

    // 4) Documento/Telefone
    let finalDocument = this.onlyDigits(dto.customer.document);
    let finalPhone = this.onlyDigits(dto.customer.phone) || '11999999999';

    if (!finalDocument || finalDocument.length < 11) {
      if (affiliateUser?.document) {
        finalDocument = this.onlyDigits(affiliateUser.document);
        this.logger.log(`Using Affiliate Document for fallback: ${finalDocument}`);
      } else {
        finalDocument =
          this.onlyDigits(sellerUser.document || '') ||
          this.onlyDigits(product.merchant.cnpj || '') ||
          '00000000000';
        this.logger.log(`Using Seller Document for fallback: ${finalDocument}`);
      }
    }

    if (!finalDocument || finalDocument.length < 11) finalDocument = '00000000000';

    // 5) IDs e valores
    const externalId = `chk_${crypto.randomUUID()}`; // seu id interno
    const amountInBRL = totalAmountInCents / 100;

    // 6) Congela split (snapshot)
    const affiliateAmountInCents =
      affiliateId && commissionRate > 0
        ? Math.round(totalAmountInCents * (commissionRate / 100))
        : 0;

    const sellerAmountInCents = totalAmountInCents - affiliateAmountInCents;

    if (sellerAmountInCents < 0) {
      throw new BadRequestException('Split inválido: comissão maior que o total.');
    }

    try {
      // 7) Cria depósito no gateway
      const keyclubResult = await this.keyclubService.createDeposit({
        amount: amountInBRL,
        externalId: externalId,
        payerName: dto.customer.name,
        payerEmail: dto.customer.email,
        payerDocument: finalDocument,
        payerPhone: finalPhone,
      });

      // 8) Salva Depósito
      // ✅ FIX CRÍTICO: netAmountInCents deve ser o líquido do produtor (sellerAmountInCents)
      await this.prisma.deposit.create({
        data: {
          id: externalId,
          externalId: keyclubResult.transactionId,
          amountInCents: totalAmountInCents,
          netAmountInCents: sellerAmountInCents,
          status: 'PENDING',
          payerName: dto.customer.name,
          payerEmail: dto.customer.email,
          payerDocument: finalDocument,
          webhookToken: crypto.randomBytes(16).toString('hex'),
          userId: sellerUser.id,
          merchantId: product.merchant.id,
          // se seu model tiver metadata, vale adicionar aqui também (se não tiver, ignora)
          // metadata: { affiliateId, commissionRate, affiliateAmountInCents, sellerAmountInCents, offerId: dto.offerId, refRaw: dto.ref }
        } as any,
      });

      // 9) Transação do produtor (líquida)
      await this.prisma.transaction.create({
        data: {
          id: externalId,
          amount: sellerAmountInCents,
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
          externalId: keyclubResult.transactionId,
          referenceId: keyclubResult.transactionId,
          pixQrCode: keyclubResult.qrcode,
          pixCopyPaste: keyclubResult.qrcode,
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

      // 10) Transação do afiliado (pendente)
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
            externalId: keyclubResult.transactionId,
            referenceId: externalId,
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
          `✅ Comissão criada: R$ ${(affiliateAmountInCents / 100).toFixed(2)} para afiliado ${affiliateId}`,
        );
      }

      return {
        success: true,
        pix: {
          qrCode: keyclubResult.qrcode,
          copyPaste: keyclubResult.qrcode,
          transactionId: keyclubResult.transactionId,
        },
      };
    } catch (error: any) {
      this.logger.error(`Checkout Error: ${error.message}`);
      throw new BadRequestException('Erro ao gerar PIX. Verifique os dados ou tente novamente.');
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
