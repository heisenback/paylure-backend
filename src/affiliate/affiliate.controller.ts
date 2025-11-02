// src/affiliate/affiliate.controller.ts
import { Controller, Post, Body, UseGuards, Get, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { RequestAffiliateDto } from './dto/request-affiliate.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

// 🚨 CORREÇÃO: Usamos o nome base 'affiliates', o main.ts adicionará /api/
@Controller('affiliates')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  /**
   * POST /api/affiliates/request
   */
  @Post('request')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async requestAffiliation(
    @Body() dto: RequestAffiliateDto,
    @GetUser() user: User
  ) {
    // O ID do usuário logado é o promoterId
    dto.promoterId = user.id;

    const affiliation = await this.affiliateService.requestAffiliation(dto);

    return {
      success: true,
      message: 'Solicitação de afiliação processada com sucesso.',
      data: affiliation,
    };
  }

  /**
   * GET /api/affiliates/my-products
   */
  @Get('my-products')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async listAffiliatesByMerchant(
    @GetUser() user: User & { merchant?: { id: string } }
  ) {
    if (!user.merchant?.id) {
      throw new ForbiddenException('Apenas Merchants (Criadores) podem acessar esta lista.');
    }

    const affiliates = await this.affiliateService.findAllByMerchant(user.merchant.id);

    return {
      success: true,
      data: affiliates,
    };
  }
}