// src/subscription/subscription.service.ts
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { SubscriptionPlan, Subscription } from '@prisma/client';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1. Cria um novo plano de assinatura.
   */
  async createPlan(dto: CreatePlanDto): Promise<SubscriptionPlan> {
    const priceInCents = Math.round(dto.price * 100);

    // 1. Verificar unicidade (garantida pelo schema, mas bom para lançar exceção)
    const exists = await this.prisma.subscriptionPlan.findUnique({
        where: {
            merchantId_name: {
                merchantId: dto.merchantId!,
                name: dto.name,
            },
        },
    });

    if (exists) {
      throw new ConflictException(`Um plano com o nome '${dto.name}' já existe.`);
    }

    // 2. Criar o plano
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        interval: dto.interval,
        priceInCents: priceInCents,
        trialPeriodDays: dto.trialPeriodDays || 0,
        merchantId: dto.merchantId!,
      },
    });

    this.logger.log(`Plano '${plan.name}' criado com sucesso para o Merchant: ${dto.merchantId}`);
    return plan;
  }

  /**
   * 2. Lista todos os planos de assinatura de um Merchant.
   */
  async findAllPlansByMerchant(merchantId: string): Promise<SubscriptionPlan[]> {
    return this.prisma.subscriptionPlan.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * 3. Lista todas as assinaturas ativas de todos os planos do Merchant.
   */
  async findAllSubscriptionsByMerchant(merchantId: string): Promise<Subscription[]> {
      return this.prisma.subscription.findMany({
          where: {
              plan: {
                  merchantId: merchantId,
              },
          },
          // Inclui o plano para mostrar nome e preço
          include: {
              plan: true,
          },
          orderBy: { nextBillingDate: 'asc' },
      });
  }
}