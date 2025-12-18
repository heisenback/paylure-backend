// src/member-area/member-area.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MemberAreaService } from './member-area.service';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { User } from '@prisma/client';
import { IsString, IsBoolean, IsOptional, IsInt, IsEnum } from 'class-validator';

// --- DTOs ---
// (Mantenha os DTOs existentes, não vou repeti-los para economizar espaço, mas eles devem estar aqui)
class CreateMemberAreaDto { @IsString() name: string; @IsString() slug: string; @IsString() @IsOptional() description?: string; @IsString() @IsOptional() coverImageUrl?: string; @IsString() @IsOptional() logoUrl?: string; @IsString() @IsOptional() primaryColor?: string; @IsString() @IsOptional() secondaryColor?: string; }
class UpdateMemberAreaDto { @IsString() @IsOptional() name?: string; @IsString() @IsOptional() description?: string; @IsString() @IsOptional() coverImageUrl?: string; @IsString() @IsOptional() logoUrl?: string; @IsString() @IsOptional() primaryColor?: string; @IsString() @IsOptional() secondaryColor?: string; @IsBoolean() @IsOptional() isActive?: boolean; }
class CreateMemberContentDto { @IsString() title: string; @IsString() @IsOptional() description?: string; @IsEnum(['VIDEO', 'PDF', 'AUDIO', 'TEXT', 'EXTERNAL_LINK']) type: 'VIDEO' | 'PDF' | 'AUDIO' | 'TEXT' | 'EXTERNAL_LINK'; @IsString() @IsOptional() contentUrl?: string; @IsString() @IsOptional() thumbnailUrl?: string; @IsInt() @IsOptional() order?: number; @IsInt() @IsOptional() duration?: number; @IsBoolean() @IsOptional() isPublic?: boolean; @IsString() @IsOptional() moduleId?: string; @IsInt() @IsOptional() releaseDays?: number; @IsOptional() attachments?: any; }
class GrantAccessDto { @IsString() userEmail: string; @IsEnum(['MANUAL', 'HOTMART', 'KIWIFY', 'PURCHASE']) grantedBy: 'MANUAL' | 'HOTMART' | 'KIWIFY' | 'PURCHASE'; @IsString() @IsOptional() externalId?: string; @IsString() @IsOptional() expiresAt?: string; }

@Controller('member-areas')
@UseGuards(AuthGuard('jwt'))
export class MemberAreaController {
  private readonly logger = new Logger(MemberAreaController.name);

  constructor(private readonly memberAreaService: MemberAreaService) {}

  // ===================================
  // 🚨 ROTAS ESPECÍFICAS PRIMEIRO
  // ===================================

  @Get('my-access')
  @HttpCode(HttpStatus.OK)
  async getMyAccess(@GetUser() user: User) {
    return this.memberAreaService.getUserAccess(user.id);
  }

  // ===================================
  // MÓDULOS (CRUD COMPLETO)
  // ===================================

  @Post(':areaId/modules')
  @HttpCode(HttpStatus.CREATED)
  async createModule(@Param('areaId') areaId: string, @Body() body: { title: string }) {
    return this.memberAreaService.createModule(areaId, body.title);
  }

  // ✅ ROTA DE EDIÇÃO DE MÓDULO
  @Put('modules/:moduleId')
  @HttpCode(HttpStatus.OK)
  async updateModule(@Param('moduleId') moduleId: string, @Body() body: { title: string }) {
    return this.memberAreaService.updateModule(moduleId, body.title);
  }

  @Delete('modules/:moduleId')
  @HttpCode(HttpStatus.OK)
  async deleteModule(@Param('moduleId') moduleId: string) {
    return this.memberAreaService.deleteModule(moduleId);
  }

  @Get(':areaId/structure')
  @HttpCode(HttpStatus.OK)
  async getCourseStructure(@Param('areaId') areaId: string) {
    return this.memberAreaService.getCourseStructure(areaId);
  }

  // ===================================
  // CONTEÚDOS (CRUD COMPLETO)
  // ===================================

  @Post(':areaId/contents')
  @HttpCode(HttpStatus.CREATED)
  async addContent(@Param('areaId') areaId: string, @Body() dto: CreateMemberContentDto) {
    return this.memberAreaService.addContent(areaId, dto);
  }

  // ✅ ROTA DE EDIÇÃO DE CONTEÚDO
  @Put('contents/:contentId')
  @HttpCode(HttpStatus.OK)
  async updateContent(@Param('contentId') contentId: string, @Body() dto: CreateMemberContentDto) {
    return this.memberAreaService.updateContent(contentId, dto);
  }

  @Delete('contents/:contentId')
  @HttpCode(HttpStatus.OK)
  async deleteContent(@Param('contentId') contentId: string) {
    return this.memberAreaService.deleteContent(contentId);
  }

  // ===================================
  // ÁREAS E ACESSOS
  // ===================================

  @Post()
  async createMemberArea(@GetUser() user: User & { merchant: { id: string } }, @Body() dto: CreateMemberAreaDto) {
    if (!user.merchant?.id) throw new Error('Usuário não possui merchant associado');
    return this.memberAreaService.createMemberArea(user.merchant.id, dto);
  }

  @Get()
  async listMemberAreas(@GetUser() user: User & { merchant: { id: string } }) {
    if (!user.merchant?.id) return { memberAreas: [] };
    return this.memberAreaService.listMemberAreas(user.merchant.id);
  }

  @Get(':slug') // :slug fica por último nas rotas GET para não conflitar
  async getMemberAreaBySlug(@Param('slug') slug: string) {
    return this.memberAreaService.getMemberAreaBySlug(slug);
  }

  @Put(':id')
  async updateMemberArea(@Param('id') id: string, @Body() dto: UpdateMemberAreaDto) {
    return this.memberAreaService.updateMemberArea(id, dto);
  }

  @Delete(':id')
  async deleteMemberArea(@Param('id') id: string) {
    return this.memberAreaService.deleteMemberArea(id);
  }

  @Post(':areaId/grant-access')
  async grantAccess(@Param('areaId') areaId: string, @Body() dto: GrantAccessDto) {
    return this.memberAreaService.grantAccess(areaId, dto);
  }

  @Delete(':areaId/revoke-access/:userId')
  async revokeAccess(@Param('areaId') areaId: string, @Param('userId') userId: string) {
    return this.memberAreaService.revokeAccess(areaId, userId);
  }

  @Get(':areaId/members')
  async listMembers(@Param('areaId') areaId: string) {
    return this.memberAreaService.listMembers(areaId);
  }
}