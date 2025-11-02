// src/subscription/subscription.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User, Subscription, SubscriptionPlan } from '@prisma/client'; // Importamos SubscriptionPlan

// 🚨 CORREÇÃO TS2339: Definimos o tipo customizado que garante o 'plan'
type SubscriptionWithPlan = Subscription & { plan: SubscriptionPlan };

@Controller('subscriptions') // CORREÇÃO: Usamos o nome base, o main.ts adiciona /api/
@UseGuards(AuthGuard('jwt')) 
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * POST /api/v1/subscriptions/plans
   */
  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  async createPlan(
    @Body() dto: CreatePlanDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      throw new ForbiddenException('Apenas Merchants podem criar planos de assinatura.');
    }

    dto.merchantId = user.merchant.id;
    const plan = await this.subscriptionService.createPlan(dto);

    return {
      success: true,
      message: `Plano '${plan.name}' criado com sucesso.`,
      data: {
          ...plan,
          price: plan.priceInCents / 100,
      },
    };
  }

  /**
   * GET /api/v1/subscriptions/plans
   */
  @Get('plans')
  @HttpCode(HttpStatus.OK)
  async listPlans(@GetUser() user: User & { merchant?: { id: string } }) {
    if (!user.merchant?.id) {
        return { success: true, data: [] };
    }

    const plans = await this.subscriptionService.findAllPlansByMerchant(user.merchant.id);
    
    const formattedPlans = plans.map(p => ({
        ...p,
        price: p.priceInCents / 100,
    }));

    return {
      success: true,
      data: formattedPlans,
    };
  }
  
  /**
   * GET /api/v1/subscriptions
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async listSubscriptions(@GetUser() user: User & { merchant?: { id: string } }) {
      if (!user.merchant?.id) {
          return { success: true, data: [] };
      }
      
      const subscriptions = await this.subscriptionService.findAllSubscriptionsByMerchant(user.merchant.id);
      
      // 🚨 CORREÇÃO: Aplicamos o cast para o tipo que inclui o 'plan'
      const subscriptionsWithPlan = subscriptions as SubscriptionWithPlan[];
      
      const formattedSubscriptions = subscriptionsWithPlan.map(s => ({
          id: s.id,
          status: s.status,
          subscriberEmail: s.subscriberEmail,
          // Acesso agora está OK:
          planName: s.plan.name, 
          nextBillingDate: s.nextBillingDate,
          price: s.plan.priceInCents / 100, 
      }));

      return {
          success: true,
          data: formattedSubscriptions,
      };
  }
}