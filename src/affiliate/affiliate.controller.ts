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

  // 1. Solicitar (Afiliado clica no marketplace)
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

  // 2. Listar Meus Afiliados (Produtor vê na aba "Afiliados")
  @Get('my-products')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async listAffiliatesByMerchant(
    @GetUser() user: User & { merchant?: { id: string } }
  ) {
    if (!user.merchant?.id) throw new ForbiddenException('Apenas produtores.');
    const data = await this.affiliateService.findAllByMerchant(user.merchant.id);
    return { success: true, data };
  }

  // 3. ✅ Listar Minhas Afiliações (Afiliado vê na aba "Produtos -> Sou Afiliado")
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async listMyAffiliations(@GetUser() user: User) {
    const data = await this.affiliateService.findMyAffiliations(user.id);
    return { success: true, data };
  }

  // 4. Aprovar/Bloquear (Produtor clica no check/ban)
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async updateStatus(
      @Param('id') id: string,
      @Body('status') status: string,
      @GetUser() user: any
  ) {
      if (!user.merchant?.id) throw new ForbiddenException('Acesso negado.');
      
      const updated = await this.affiliateService.updateStatus(id, status, user.merchant.id);
      
      return {
          success: true,
          message: `Status atualizado para ${status}`,
          data: updated
      };
  }
}