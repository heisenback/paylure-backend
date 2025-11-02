// src/membership/membership.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { MembershipIntegration } from '@prisma/client';

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria uma nova integração de Área de Membros (Webhook).
   */
  async createIntegration(dto: CreateIntegrationDto): Promise<MembershipIntegration> {
    const integration = await this.prisma.membershipIntegration.create({
      data: {
        name: dto.name,
        webhookUrl: dto.webhookUrl,
        platform: dto.platform,
        secretKey: dto.secretKey,
        merchantId: dto.merchantId!, // Sabemos que o ID virá do Controller
      },
    });

    this.logger.log(`Nova integração de membros '${integration.name}' criada para o Merchant: ${dto.merchantId}`);
    return integration;
  }

  /**
   * Lista todas as integrações de Área de Membros de um Merchant.
   */
  async findAllByMerchant(merchantId: string): Promise<MembershipIntegration[]> {
    return this.prisma.membershipIntegration.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}