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
    const existing = await this.prisma.memberArea.findUnique({
      where: { slug: data.slug },
    });

    if (existing) {
      throw new BadRequestException('Este slug já está em uso');
    }

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

    this.logger.log(`✅ Área criada: ${area.name}`);

    return { area, message: 'Área de membros criada com sucesso!' };
  }

  async listMemberAreas(merchantId: string) {
    const areas = await this.prisma.memberArea.findMany({
      where: { merchantId },
      include: {
        _count: {
          select: {
            contents: true,
            accesses: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { memberAreas: areas };
  }

  async getMemberAreaBySlug(slug: string) {
    const area = await this.prisma.memberArea.findUnique({
      where: { slug },
      include: {
        contents: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!area) {
      throw new NotFoundException('Área de membros não encontrada');
    }

    return { area };
  }

  // ✅ NOVO: Busca estrutura completa (Módulos + Aulas)
  async getCourseStructure(memberAreaId: string) {
    const modules = await this.prisma.memberModule.findMany({
      where: { memberAreaId },
      include: {
        contents: {
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { order: 'asc' }
    });
    return modules;
  }

  async updateMemberArea(id: string, data: any) {
    const area = await this.prisma.memberArea.update({
      where: { id },
      data,
    });

    this.logger.log(`✅ Área atualizada: ${area.name}`);

    return { area, message: 'Área atualizada com sucesso!' };
  }

  async deleteMemberArea(id: string) {
    await this.prisma.memberArea.delete({
      where: { id },
    });

    this.logger.log(`✅ Área deletada: ${id}`);

    return { message: 'Área de membros deletada com sucesso!' };
  }

  // ===================================
  // MODULES (NOVOS MÉTODOS)
  // ===================================

  async createModule(memberAreaId: string, title: string) {
    const count = await this.prisma.memberModule.count({ where: { memberAreaId } });
    const module = await this.prisma.memberModule.create({
      data: {
        memberAreaId,
        title,
        order: count + 1
      }
    });
    return module;
  }

  async deleteModule(moduleId: string) {
    return this.prisma.memberModule.delete({ where: { id: moduleId } });
  }

  // ===================================
  // MEMBER CONTENT (ATUALIZADO)
  // ===================================

  async addContent(memberAreaId: string, data: any) {
    // Se tiver moduleId, calcula ordem dentro do módulo
    let order = 0;
    if (data.moduleId) {
        const last = await this.prisma.memberContent.findFirst({
            where: { moduleId: data.moduleId },
            orderBy: { order: 'desc' }
        });
        order = last ? last.order + 1 : 1;
    } else {
        const last = await this.prisma.memberContent.findFirst({
            where: { memberAreaId, moduleId: null },
            orderBy: { order: 'desc' }
        });
        order = last ? last.order + 1 : 1;
    }

    const content = await this.prisma.memberContent.create({
      data: {
        memberAreaId,
        moduleId: data.moduleId, // ✅ Vincula ao módulo
        title: data.title,
        description: data.description,
        type: data.type || 'VIDEO',
        contentUrl: data.contentUrl,
        thumbnailUrl: data.thumbnailUrl,
        releaseDays: Number(data.releaseDays || 0), // ✅ Drip
        attachments: data.attachments || [], // ✅ Anexos
        order: data.order || order,
        duration: data.duration,
        isPublic: data.isPublic || false,
      },
    });

    this.logger.log(`✅ Conteúdo adicionado: ${content.title}`);

    return { content, message: 'Conteúdo adicionado com sucesso!' };
  }

  async deleteContent(contentId: string) {
    await this.prisma.memberContent.delete({
      where: { id: contentId },
    });

    this.logger.log(`✅ Conteúdo deletado: ${contentId}`);

    return { message: 'Conteúdo removido com sucesso!' };
  }

  // ===================================
  // MEMBER ACCESS
  // ===================================

  async grantAccess(memberAreaId: string, data: any) {
    let user = await this.prisma.user.findUnique({
      where: { email: data.userEmail },
    });

    if (!user) {
      const randomPassword = Math.random().toString(36).slice(-12);
      user = await this.prisma.user.create({
        data: {
          email: data.userEmail,
          name: data.userEmail.split('@')[0],
          password: randomPassword, 
          apiKey: `temp_${Date.now()}`,
          apiSecret: `temp_${Date.now()}`,
        },
      });
      this.logger.log(`✅ Usuário criado: ${user.email}`);
    }

    const access = await this.prisma.memberAccess.upsert({
      where: {
        userId_memberAreaId: {
          userId: user.id,
          memberAreaId,
        },
      },
      create: {
        userId: user.id,
        memberAreaId,
        grantedBy: data.grantedBy,
        externalId: data.externalId,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
      update: {
        isActive: true,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });

    this.logger.log(`✅ Acesso concedido para: ${user.email}`);

    return {
      access,
      user: { id: user.id, email: user.email, name: user.name },
      message: 'Acesso concedido com sucesso!',
    };
  }

  async revokeAccess(memberAreaId: string, userId: string) {
    await this.prisma.memberAccess.update({
      where: {
        userId_memberAreaId: {
          userId,
          memberAreaId,
        },
      },
      data: {
        isActive: false,
      },
    });

    this.logger.log(`✅ Acesso revogado para userId: ${userId}`);

    return { message: 'Acesso revogado com sucesso!' };
  }

  async listMembers(memberAreaId: string) {
    const accesses = await this.prisma.memberAccess.findMany({
      where: { memberAreaId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { members: accesses };
  }

  async getUserAccess(userId: string) {
    const accesses = await this.prisma.memberAccess.findMany({
      where: {
        userId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        memberArea: {
          include: {
            contents: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    return { areas: accesses.map(a => a.memberArea) };
  }
}