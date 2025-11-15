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
    // Verifica se slug já existe
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
  // MEMBER CONTENT
  // ===================================

  async addContent(memberAreaId: string, data: any) {
    const content = await this.prisma.memberContent.create({
      data: {
        memberAreaId,
        title: data.title,
        description: data.description,
        type: data.type,
        contentUrl: data.contentUrl,
        thumbnailUrl: data.thumbnailUrl,
        order: data.order || 0,
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
    // Busca ou cria usuário pelo email
    let user = await this.prisma.user.findUnique({
      where: { email: data.userEmail },
    });

    if (!user) {
      // Cria usuário temporário (sem senha - acesso apenas via área de membros)
      const randomPassword = Math.random().toString(36).slice(-12);
      
      user = await this.prisma.user.create({
        data: {
          email: data.userEmail,
          name: data.userEmail.split('@')[0],
          password: randomPassword, // Será solicitado a definir senha no primeiro acesso
          apiKey: `temp_${Date.now()}`,
          apiSecret: `temp_${Date.now()}`,
        },
      });

      this.logger.log(`✅ Usuário criado: ${user.email}`);
    }

    // Concede acesso
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