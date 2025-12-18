// src/product/product.module.ts
import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MailModule } from 'src/mail/mail.module'; // ✅ 1. IMPORTAR O MÓDULO DE EMAIL

@Module({
  imports: [
    PrismaModule, 
    MailModule // ✅ 2. ADICIONAR AQUI NOS IMPORTS
  ],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}