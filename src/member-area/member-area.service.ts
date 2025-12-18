// src/member-area/member-area.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MemberAreaService {
  private readonly logger = new Logger(MemberAreaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ===================================
  // MEMBER AREAS
  // ===================================

  async createMemberArea(merchantId: string, data: any) {
    const existing = await this.prisma.memberArea.findUnique({ where: { slug: data.slug } });
    if (existing) throw new BadRequestException('Este slug já está em uso');
    const area = await this.prisma.memberArea.create({
      data: {
        merchantId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        coverImageUrl: data.coverImageUrl,
        logoUrl: data.logoUrl,
        primaryColor: data.primaryColor || '#9333ea',
        secondaryColor: data.secondaryColor || '#06b6d4',
      },
    });
    return { area, message: 'Área criada com sucesso!' };
  }

  async listMemberAreas(merchantId: string) {
    return { memberAreas: await this.prisma.memberArea.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } }) };
  }

  async getMemberAreaBySlug(slug: string) {
    const area = await this.prisma.memberArea.findUnique({ where: { slug } });
    if (!area) throw new NotFoundException('Área não encontrada');
    return { area };
  }

  async updateMemberArea(id: string, data: any) {
    const area = await this.prisma.memberArea.update({ where: { id }, data });
    return { area, message: 'Área atualizada!' };
  }

  async deleteMemberArea(id: string) {
    await this.prisma.memberArea.delete({ where: { id } });
    return { message: 'Área deletada!' };
  }

  // ✅ NOVO: Busca estrutura completa
  async getCourseStructure(memberAreaId: string) {
    return await this.prisma.memberModule.findMany({
      where: { memberAreaId },
      include: { contents: { orderBy: { order: 'asc' } } },
      orderBy: { order: 'asc' }
    });
  }

  // ===================================
  // MÓDULOS
  // ===================================

  async createModule(memberAreaId: string, title: string) {
    const count = await this.prisma.memberModule.count({ where: { memberAreaId } });
    return await this.prisma.memberModule.create({
      data: { memberAreaId, title, order: count + 1 }
    });
  }

  // ✅ NOVO: ATUALIZAR MÓDULO
  async updateModule(moduleId: string, title: string) {
    return await this.prisma.memberModule.update({
      where: { id: moduleId },
      data: { title }
    });
  }

  async deleteModule(moduleId: string) {
    return await this.prisma.memberModule.delete({ where: { id: moduleId } });
  }

  // ===================================
  // CONTEÚDOS (AULAS)
  // ===================================

  async addContent(memberAreaId: string, data: any) {
    let order = 0;
    if (data.moduleId) {
        const last = await this.prisma.memberContent.findFirst({ where: { moduleId: data.moduleId }, orderBy: { order: 'desc' } });
        order = last ? last.order + 1 : 1;
    } else {
        const last = await this.prisma.memberContent.findFirst({ where: { memberAreaId, moduleId: null }, orderBy: { order: 'desc' } });
        order = last ? last.order + 1 : 1;
    }

    const content = await this.prisma.memberContent.create({
      data: {
        memberAreaId,
        moduleId: data.moduleId,
        title: data.title,
        description: data.description,
        type: data.type || 'VIDEO',
        contentUrl: data.contentUrl,
        thumbnailUrl: data.thumbnailUrl,
        releaseDays: Number(data.releaseDays || 0),
        attachments: data.attachments || [],
        order: order,
        duration: data.duration,
        isPublic: data.isPublic || false,
      },
    });
    return { content };
  }

  // ✅ NOVO: ATUALIZAR AULA
  async updateContent(contentId: string, data: any) {
    const content = await this.prisma.memberContent.update({
      where: { id: contentId },
      data: {
        title: data.title,
        description: data.description,
        contentUrl: data.contentUrl,
        releaseDays: Number(data.releaseDays || 0),
        attachments: data.attachments || [],
        // Adicione outros campos se necessário
      }
    });
    return { content };
  }

  async deleteContent(contentId: string) {
    await this.prisma.memberContent.delete({ where: { id: contentId } });
    return { message: 'Conteúdo deletado!' };
  }

  // ===================================
  // ACESSOS
  // ===================================

  async grantAccess(memberAreaId: string, data: any) {
    let user = await this.prisma.user.findUnique({ where: { email: data.userEmail } });
    if (!user) {
      const randomPassword = Math.random().toString(36).slice(-12);
      user = await this.prisma.user.create({
        data: { email: data.userEmail, name: data.userEmail.split('@')[0], password: randomPassword, apiKey: `temp_${Date.now()}`, apiSecret: `temp_${Date.now()}` },
      });
    }
    const access = await this.prisma.memberAccess.upsert({
      where: { userId_memberAreaId: { userId: user.id, memberAreaId } },
      create: { userId: user.id, memberAreaId, grantedBy: data.grantedBy, externalId: data.externalId, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null },
      update: { isActive: true, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null },
    });
    return { access, user: { id: user.id, email: user.email }, message: 'Acesso concedido!' };
  }

  async revokeAccess(memberAreaId: string, userId: string) {
    await this.prisma.memberAccess.update({
      where: { userId_memberAreaId: { userId, memberAreaId } },
      data: { isActive: false },
    });
    return { message: 'Acesso revogado!' };
  }

  async listMembers(memberAreaId: string) {
    const accesses = await this.prisma.memberAccess.findMany({
      where: { memberAreaId },
      include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { members: accesses };
  }

  async getUserAccess(userId: string) {
    const accesses = await this.prisma.memberAccess.findMany({
      where: { userId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { memberArea: { include: { contents: { orderBy: { order: 'asc' } } } } },
    });
    return { areas: accesses.map(a => a.memberArea) };
  }
}