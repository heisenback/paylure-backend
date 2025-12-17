// src/pixels/pixels.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePixelDto } from './dto/create-pixel.dto';

@Injectable()
export class PixelsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePixelDto) {
    return this.prisma.pixel.create({
      data: {
        userId,
        name: dto.name,
        platform: dto.platform as any,
        pixelId: dto.pixelId,
        accessToken: dto.accessToken,
        testCode: dto.testCode,
        active: dto.active ?? true,
        events: dto.events as any, // Prisma lida com JSON
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.pixel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const pixel = await this.prisma.pixel.findFirst({
      where: { id, userId },
    });
    if (!pixel) throw new NotFoundException('Pixel não encontrado');
    return pixel;
  }

  async update(id: string, userId: string, dto: CreatePixelDto) {
    // Garante que o pixel pertence ao user antes de editar
    await this.findOne(id, userId);

    return this.prisma.pixel.update({
      where: { id },
      data: {
        name: dto.name,
        platform: dto.platform as any,
        pixelId: dto.pixelId,
        accessToken: dto.accessToken,
        testCode: dto.testCode,
        active: dto.active,
        events: dto.events as any,
      },
    });
  }

  async toggleActive(id: string, userId: string, active: boolean) {
    await this.findOne(id, userId);
    return this.prisma.pixel.update({
      where: { id },
      data: { active },
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    return this.prisma.pixel.delete({
      where: { id },
    });
  }
}