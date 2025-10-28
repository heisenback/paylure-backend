// src/merchant/merchant.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';

@Injectable()
export class MerchantService {
  // Pedimos ao Nest para "injetar" (entregar) o PrismaService
  constructor(private readonly prisma: PrismaService) {}

  // Função para criar uma nova loja (merchant)
  async createMerchant(dto: CreateMerchantDto, userId: string) {
    // 1. Verificar se o CNPJ já está em uso
    const cnpjExists = await this.prisma.merchant.findUnique({
      where: { cnpj: dto.cnpj },
    });

    if (cnpjExists) {
      throw new ConflictException('Este CNPJ já está em uso.');
    }

    // 2. Verificar se este usuário JÁ POSSUI uma loja
    // (Nosso 'schema.prisma' diz que 1 usuário só pode ter 1 loja)
    const userAlreadyHasMerchant = await this.prisma.merchant.findUnique({
      where: { userId: userId },
    });

    if (userAlreadyHasMerchant) {
      throw new ConflictException('Este usuário já possui uma loja cadastrada.');
    }

    // 3. Se tudo estiver OK, criar a loja
    const merchant = await this.prisma.merchant.create({
      data: {
        storeName: dto.storeName,
        cnpj: dto.cnpj,
        logoUrl: dto.logoUrl, // Opcional
        pixKey: dto.pixKey,   // Opcional
        // A "ligação" mais importante:
        user: {
          connect: {
            id: userId,
          },
        },
      },
    });

    return merchant;
  }
}