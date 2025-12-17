// src/member-area/member-area.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MemberAreaService } from './member-area.service';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';
import { IsString, IsBoolean, IsOptional, IsInt, IsEnum } from 'class-validator';

// ... (Mantenha seus DTOs aqui: CreateMemberAreaDto, UpdateMemberAreaDto, etc. Exatamente como estavam) ...
class CreateMemberAreaDto {
  @IsString() name: string;
  @IsString() slug: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() coverImageUrl?: string;
  @IsString() @IsOptional() logoUrl?: string;
  @IsString() @IsOptional() primaryColor?: string = '#9333ea';
  @IsString() @IsOptional() secondaryColor?: string = '#06b6d4';
}

class UpdateMemberAreaDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() coverImageUrl?: string;
  @IsString() @IsOptional() logoUrl?: string;
  @IsString() @IsOptional() primaryColor?: string;
  @IsString() @IsOptional() secondaryColor?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

class CreateMemberContentDto {
  @IsString() title: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(['VIDEO', 'PDF', 'AUDIO', 'TEXT', 'EXTERNAL_LINK']) type: 'VIDEO' | 'PDF' | 'AUDIO' | 'TEXT' | 'EXTERNAL_LINK';
  @IsString() @IsOptional() contentUrl?: string;
  @IsString() @IsOptional() thumbnailUrl?: string;
  @IsInt() @IsOptional() order?: number = 0;
  @IsInt() @IsOptional() duration?: number;
  @IsBoolean() @IsOptional() isPublic?: boolean = false;
}

class GrantAccessDto {
  @IsString() userEmail: string;
  @IsEnum(['MANUAL', 'HOTMART', 'KIWIFY', 'PURCHASE']) grantedBy: 'MANUAL' | 'HOTMART' | 'KIWIFY' | 'PURCHASE';
  @IsString() @IsOptional() externalId?: string;
  @IsString() @IsOptional() expiresAt?: string;
}

@Controller('member-areas')
@UseGuards(AuthGuard('jwt'))
export class MemberAreaController {
  private readonly logger = new Logger(MemberAreaController.name);

  constructor(private readonly memberAreaService: MemberAreaService) {}

  // ===================================
  // 🚨 CORREÇÃO: ROTAS ESPECÍFICAS PRIMEIRO
  // ===================================

  /**
   * GET /api/v1/member-areas/my-access
   * Lista áreas que o usuário tem acesso
   * ✅ MOVIDO PARA O TOPO para não conflitar com :slug ou :id
   */
  @Get('my-access')
  @HttpCode(HttpStatus.OK)
  async getMyAccess(@GetUser() user: User) {
    this.logger.log(`📺 Áreas acessíveis por: ${user.email}`);
    return this.memberAreaService.getUserAccess(user.id);
  }

  // ===================================
  // MEMBER AREAS (Genéricas)
  // ===================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMemberArea(
    @GetUser() user: User & { merchant: { id: string } },
    @Body() dto: CreateMemberAreaDto,
  ) {
    this.logger.log(`📺 Criando área de membros: ${dto.name}`);
    if (!user.merchant?.id) throw new Error('Usuário não possui merchant associado');
    return this.memberAreaService.createMemberArea(user.merchant.id, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listMemberAreas(@GetUser() user: User & { merchant: { id: string } }) {
    this.logger.log(`📺 Listando áreas de membros`);
    if (!user.merchant?.id) return { memberAreas: [] };
    return this.memberAreaService.listMemberAreas(user.merchant.id);
  }

  /**
   * GET /api/v1/member-areas/:slug
   * ✅ Agora esta rota só é chamada se NÃO for 'my-access'
   */
  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  async getMemberAreaBySlug(@Param('slug') slug: string) {
    this.logger.log(`📺 Buscando área: ${slug}`);
    return this.memberAreaService.getMemberAreaBySlug(slug);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateMemberArea(
    @Param('id') id: string,
    @Body() dto: UpdateMemberAreaDto,
  ) {
    this.logger.log(`📺 Atualizando área: ${id}`);
    return this.memberAreaService.updateMemberArea(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteMemberArea(@Param('id') id: string) {
    this.logger.log(`📺 Deletando área: ${id}`);
    return this.memberAreaService.deleteMemberArea(id);
  }

  // ===================================
  // MEMBER CONTENT
  // ===================================

  @Post(':areaId/contents')
  @HttpCode(HttpStatus.CREATED)
  async addContent(
    @Param('areaId') areaId: string,
    @Body() dto: CreateMemberContentDto,
  ) {
    this.logger.log(`📹 Adicionando conteúdo à área: ${areaId}`);
    return this.memberAreaService.addContent(areaId, dto);
  }

  @Delete('contents/:contentId')
  @HttpCode(HttpStatus.OK)
  async deleteContent(@Param('contentId') contentId: string) {
    this.logger.log(`📹 Removendo conteúdo: ${contentId}`);
    return this.memberAreaService.deleteContent(contentId);
  }

  // ===================================
  // MEMBER ACCESS
  // ===================================

  @Post(':areaId/grant-access')
  @HttpCode(HttpStatus.CREATED)
  async grantAccess(
    @Param('areaId') areaId: string,
    @Body() dto: GrantAccessDto,
  ) {
    this.logger.log(`🔑 Concedendo acesso à área: ${areaId}`);
    return this.memberAreaService.grantAccess(areaId, dto);
  }

  @Delete(':areaId/revoke-access/:userId')
  @HttpCode(HttpStatus.OK)
  async revokeAccess(
    @Param('areaId') areaId: string,
    @Param('userId') userId: string,
  ) {
    this.logger.log(`🔑 Revogando acesso à área: ${areaId}`);
    return this.memberAreaService.revokeAccess(areaId, userId);
  }

  @Get(':areaId/members')
  @HttpCode(HttpStatus.OK)
  async listMembers(@Param('areaId') areaId: string) {
    this.logger.log(`👥 Listando membros da área: ${areaId}`);
    return this.memberAreaService.listMembers(areaId);
  }
}