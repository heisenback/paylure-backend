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
class CreateMemberAreaDto {
  @IsString() name: string;
  @IsString() slug: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() coverImageUrl?: string;
  @IsString() @IsOptional() logoUrl?: string;
  @IsString() @IsOptional() primaryColor?: string = '#9333ea';
  @IsString() @IsOptional() secondaryColor?: string = '#06b6d4';
  @IsBoolean() @IsOptional() allowComments?: boolean = true;
}

class UpdateMemberAreaDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() coverImageUrl?: string;
  @IsString() @IsOptional() logoUrl?: string;
  @IsString() @IsOptional() primaryColor?: string;
  @IsString() @IsOptional() secondaryColor?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsBoolean() @IsOptional() allowComments?: boolean;
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
  @IsString() @IsOptional() moduleId?: string; 
  @IsInt() @IsOptional() releaseDays?: number;
  @IsOptional() attachments?: any; 
}

class GrantAccessDto {
  @IsString() userEmail: string;
  @IsEnum(['MANUAL', 'HOTMART', 'KIWIFY', 'PURCHASE']) grantedBy: 'MANUAL' | 'HOTMART' | 'KIWIFY' | 'PURCHASE';
  @IsString() @IsOptional() externalId?: string;
  @IsString() @IsOptional() expiresAt?: string;
}

class AddCommentDto {
  @IsString() text: string;
}

@Controller('member-areas')
@UseGuards(AuthGuard('jwt'))
export class MemberAreaController {
  private readonly logger = new Logger(MemberAreaController.name);

  constructor(private readonly memberAreaService: MemberAreaService) {}

  // ===================================
  // ACESSOS E PROGRESSO (ALUNO)
  // ===================================

  @Get('my-access')
  @HttpCode(HttpStatus.OK)
  async getMyAccess(@GetUser() user: User) {
    return this.memberAreaService.getUserAccess(user.id);
  }

  @Get(':areaId/student-progress')
  @HttpCode(HttpStatus.OK)
  async getStudentProgress(@Param('areaId') areaId: string, @GetUser() user: User) {
    return this.memberAreaService.getStudentProgress(user.id, areaId);
  }

  @Post('contents/:contentId/toggle-completion')
  @HttpCode(HttpStatus.OK)
  async toggleCompletion(@Param('contentId') contentId: string, @GetUser() user: User) {
    return this.memberAreaService.toggleCompletion(user.id, contentId);
  }

  // ===================================
  // COMENTÁRIOS
  // ===================================

  @Get('contents/:contentId/comments')
  @HttpCode(HttpStatus.OK)
  async getComments(@Param('contentId') contentId: string) {
    return this.memberAreaService.getComments(contentId);
  }

  @Post('contents/:contentId/comments')
  @HttpCode(HttpStatus.CREATED)
  async addComment(@Param('contentId') contentId: string, @GetUser() user: User, @Body() dto: AddCommentDto) {
    return this.memberAreaService.addComment(user.id, contentId, dto.text);
  }

  // ===================================
  // MÓDULOS 
  // ===================================

  @Post(':areaId/modules')
  @HttpCode(HttpStatus.CREATED)
  async createModule(@Param('areaId') areaId: string, @Body() body: { title: string }) {
    return this.memberAreaService.createModule(areaId, body.title);
  }

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
  // CONTEÚDOS E ACESSOS
  // ===================================

  @Post(':areaId/contents')
  @HttpCode(HttpStatus.CREATED)
  async addContent(@Param('areaId') areaId: string, @Body() dto: CreateMemberContentDto) {
    return this.memberAreaService.addContent(areaId, dto);
  }

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

  @Post(':areaId/grant-access')
  @HttpCode(HttpStatus.CREATED)
  async grantAccess(@Param('areaId') areaId: string, @Body() dto: GrantAccessDto) {
    return this.memberAreaService.grantAccess(areaId, dto);
  }

  @Delete(':areaId/revoke-access/:userId')
  @HttpCode(HttpStatus.OK)
  async revokeAccess(@Param('areaId') areaId: string, @Param('userId') userId: string) {
    return this.memberAreaService.revokeAccess(areaId, userId);
  }

  // ===================================
  // MEMBER AREAS (Genéricas)
  // ===================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createMemberArea(@GetUser() user: User & { merchant: { id: string } }, @Body() dto: CreateMemberAreaDto) {
    if (!user.merchant?.id) throw new Error('Usuário não possui merchant associado');
    return this.memberAreaService.createMemberArea(user.merchant.id, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listMemberAreas(@GetUser() user: User & { merchant: { id: string } }) {
    if (!user.merchant?.id) return { memberAreas: [] };
    return this.memberAreaService.listMemberAreas(user.merchant.id);
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  async getMemberAreaBySlug(@Param('slug') slug: string) {
    return this.memberAreaService.getMemberAreaBySlug(slug);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateMemberArea(@Param('id') id: string, @Body() dto: UpdateMemberAreaDto) {
    return this.memberAreaService.updateMemberArea(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteMemberArea(@Param('id') id: string) {
    return this.memberAreaService.deleteMemberArea(id);
  }

  @Get(':areaId/members')
  @HttpCode(HttpStatus.OK)
  async listMembers(@Param('areaId') areaId: string) {
    return this.memberAreaService.listMembers(areaId);
  }
}