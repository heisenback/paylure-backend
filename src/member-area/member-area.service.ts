// src/member-area/member-area.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MemberAreaService {
  private readonly logger = new Logger(MemberAreaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ===================================
  // ACESSOS & PROGRESSO
  // ===================================

  async getStudentProgress(userId: string, memberAreaId: string) {
    // Busca IDs das aulas concluídas pelo aluno nesta área
    const progress = await this.prisma.lessonProgress.findMany({
        where: { 
            userId, 
            content: { memberAreaId },
            completed: true 
        },
        select: { contentId: true }
    });
    // Retorna apenas um array de IDs: ['aula1-id', 'aula2-id']
    return progress.map(p => p.contentId);
  }

  async toggleCompletion(userId: string, contentId: string) {
    const exists = await this.prisma.lessonProgress.findUnique({
        where: { userId_contentId: { userId, contentId } }
    });

    if (exists) {
        // Se já existe, inverte o status
        const updated = await this.prisma.lessonProgress.update({
            where: { id: exists.id },
            data: { completed: !exists.completed }
        });
        return { completed: updated.completed };
    } else {
        // Se não existe, cria como concluído
        await this.prisma.lessonProgress.create({
            data: { userId, contentId, completed: true }
        });
        return { completed: true };
    }
  }

  // ===================================
  // COMENTÁRIOS
  // ===================================

  async getComments(contentId: string) {
    return await this.prisma.comment.findMany({
        where: { contentId },
        include: { 
            user: { 
                select: { name: true, email: true } 
            } 
        },
        orderBy: { createdAt: 'desc' }
    });
  }

  async addComment(userId: string, contentId: string, text: string) {
    return await this.prisma.comment.create({
        data: { userId, contentId, text },
        include: { user: { select: { name: true } } }
    });
  }

  // ===================================
  // MEMBER AREAS (CRUD)
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
        allowComments: data.allowComments ?? true,
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
    await this.prisma.memberArea.delete({ where: { id } });
    this.logger.log(`✅ Área deletada: ${id}`);
    return { message: 'Área de membros deletada com sucesso!' };
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
        moduleId: data.moduleId,
        title: data.title,
        description: data.description,
        type: data.type || 'VIDEO',
        contentUrl: data.contentUrl,
        thumbnailUrl: data.thumbnailUrl,
        releaseDays: Number(data.releaseDays || 0),
        attachments: data.attachments || [],
        order: data.order || order,
        duration: data.duration,
        isPublic: data.isPublic || false,
      },
    });

    this.logger.log(`✅ Conteúdo adicionado: ${content.title}`);
    return { content, message: 'Conteúdo adicionado com sucesso!' };
  }

  async updateContent(contentId: string, data: any) {
    const content = await this.prisma.memberContent.update({
        where: { id: contentId },
        data: {
            title: data.title,
            description: data.description,
            contentUrl: data.contentUrl,
            releaseDays: Number(data.releaseDays || 0),
            attachments: data.attachments || [],
        }
    });
    return { content, message: 'Conteúdo atualizado!' };
  }

  async deleteContent(contentId: string) {
    await this.prisma.memberContent.delete({ where: { id: contentId } });
    this.logger.log(`✅ Conteúdo deletado: ${contentId}`);
    return { message: 'Conteúdo removido com sucesso!' };
  }

  // ===================================
  // ACESSOS (GERAIS)
  // ===================================

  async grantAccess(memberAreaId: string, data: any) {
    let user = await this.prisma.user.findUnique({ where: { email: data.userEmail } });
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
      where: { userId_memberAreaId: { userId: user.id, memberAreaId } },
      create: { userId: user.id, memberAreaId, grantedBy: data.grantedBy, externalId: data.externalId, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null },
      update: { isActive: true, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null },
    });

    this.logger.log(`✅ Acesso concedido para: ${user.email}`);
    return { access, user: { id: user.id, email: user.email, name: user.name }, message: 'Acesso concedido com sucesso!' };
  }

  async revokeAccess(memberAreaId: string, userId: string) {
    await this.prisma.memberAccess.update({
      where: { userId_memberAreaId: { userId, memberAreaId } },
      data: { isActive: false },
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

  // ===================================
  // 🔥 LÓGICA HÍBRIDA (ALUNO + DONO)
  // ===================================
  async getUserAccess(userId: string) {
    // 1. Busca os cursos que o usuário COMPROU (MemberAccess)
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
            contents: { select: { id: true } }, // Traz só ID para contagem leve
          },
        },
      },
    });

    // 2. Busca os cursos que o usuário É DONO (Merchant -> MemberArea)
    const ownedAreas = await this.prisma.memberArea.findMany({
      where: {
        merchant: { userId: userId } // Verifica se o usuário é o dono do Merchant
      },
      include: {
        contents: { select: { id: true } }
      }
    });

    // 3. Formata a lista de Compras
    const formattedPurchased = accesses.map(a => ({
      id: a.memberArea.id,
      title: a.memberArea.name,
      description: a.memberArea.description,
      slug: a.memberArea.slug,
      imageUrl: a.memberArea.coverImageUrl,
      deliveryMethod: 'PAYLURE_MEMBERS',
      totalLessons: a.memberArea.contents.length,
      isOwner: false // É aluno
    }));

    // 4. Formata a lista de Dono
    const formattedOwned = ownedAreas.map(area => ({
      id: area.id,
      title: area.name,
      description: area.description,
      slug: area.slug,
      imageUrl: area.coverImageUrl,
      deliveryMethod: 'PAYLURE_MEMBERS',
      totalLessons: area.contents.length,
      isOwner: true // É o dono (admin)
    }));

    // 5. Junta tudo (Prioridade para Dono + Compras)
    const allCourses = [...formattedOwned];

    formattedPurchased.forEach(course => {
      // Evita duplicar se você comprou seu próprio curso (já está na lista de owned)
      if (!allCourses.find(c => c.id === course.id)) {
        allCourses.push(course);
      }
    });

    return { areas: allCourses };
  }
}