// src/membership/membership.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

// Rota principal para gerenciamento de membros
@Controller('membership')
@UseGuards(AuthGuard('jwt')) // Protege todas as rotas deste Controller com JWT
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  /**
   * POST /api/v1/membership/integrations
   * Cadastra uma nova integração de webhook para a área de membros.
   */
  @Post('integrations')
  @HttpCode(HttpStatus.CREATED)
  async createIntegration(
    @Body() dto: CreateIntegrationDto,
    @GetUser() user: User & { merchant?: { id: string } },
  ) {
    if (!user.merchant?.id) {
      throw new Error('Usuário não tem um Merchant ID associado.');
    }

    // Injeta o Merchant ID do usuário logado no DTO
    dto.merchantId = user.merchant.id;

    const integration = await this.membershipService.createIntegration(dto);

    return {
      success: true,
      message: `Integração '${integration.name}' criada com sucesso.`,
      data: integration,
    };
  }

  /**
   * GET /api/v1/membership/integrations
   * Lista todas as integrações de área de membros do Merchant.
   */
  @Get('integrations')
  @HttpCode(HttpStatus.OK)
  async findAllIntegrations(@GetUser() user: User & { merchant?: { id: string } }) {
    if (!user.merchant?.id) {
      return { success: true, data: [] };
    }

    const integrations = await this.membershipService.findAllByMerchant(user.merchant.id);

    return {
      success: true,
      data: integrations,
    };
  }
}
