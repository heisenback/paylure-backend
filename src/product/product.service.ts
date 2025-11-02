// src/product/product.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto'; 
import { Product } from '@prisma/client';

@Injectable()
export class ProductService { // 🚨 CORREÇÃO: Classe nomeada corretamente
    private readonly logger = new Logger(ProductService.name);

    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreateProductDto, merchantId: string): Promise<Product> {
        // Assumindo que o DTO tem title, description, price
        const priceInCents = Math.round((dto as any).price * 100);

        const newProduct = await this.prisma.product.create({
            data: {
                name: (dto as any).title, // Mapeia 'title' do DTO para 'name' do Prisma
                description: (dto as any).description,
                priceInCents: priceInCents,
                merchantId: merchantId,
            },
        });

        this.logger.log(`Produto '${newProduct.name}' criado com sucesso.`);
        return newProduct;
    }
    
    async findAllByMerchant(merchantId: string): Promise<Product[]> {
        return this.prisma.product.findMany({
            where: { merchantId },
            orderBy: { createdAt: 'desc' },
        });
    }
}