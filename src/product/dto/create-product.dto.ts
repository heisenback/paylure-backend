// src/product/dto/create-product.dto.ts
import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, IsObject, IsBoolean } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0.01)
  price: number; // Em REAIS

  // ✅ NOVOS CAMPOS PARA SUPORTE TOTAL AO FRONTEND
  
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  deliveryMethod?: string;

  @IsString()
  @IsOptional()
  paymentType?: string;

  @IsObject()
  @IsOptional()
  checkoutConfig?: any;

  // Lógica de Marketplace e Afiliação
  @IsBoolean()
  @IsOptional()
  isAffiliationEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  showInMarketplace?: boolean;

  // ✅ NOVO: Campo content para módulos e aulas da área de membros
  @IsOptional()
  content?: any;
}