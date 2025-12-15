// src/affiliate/affiliate.controller.ts
import { Controller, Post, Body, UseGuards, Get, Patch, Param, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { RequestAffiliateDto } from './dto/request-affiliate.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';

@Controller('affiliates')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Post('request')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async requestAffiliation(
    @Body() dto: RequestAffiliateDto,
    @GetUser() user: User
  ) {
    dto.promoterId = user.id;
    const result = await this.affiliateService.requestAffiliation(dto);
    
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

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
    return { success: true, data: affiliates };
  }

  // ✅ NOVA ROTA: Aprovar ou Bloquear
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async updateStatus(
      @Param('id') id: string,
      @Body('status') status: string,
      @GetUser() user: any
  ) {
      if (!user.merchant?.id) {
          throw new ForbiddenException('Acesso negado.');
      }
      
      const updated = await this.affiliateService.updateStatus(id, status, user.merchant.id);
      
      return {
          success: true,
          message: `Status atualizado para ${status}`,
          data: updated
      };
  }
}