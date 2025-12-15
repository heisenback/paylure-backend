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
  price: number; // Valor em REAIS que vem do front

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

  // ✅ NOVOS CAMPOS ACEITOS NA API
  @IsBoolean()
  @IsOptional()
  isAffiliationEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  showInMarketplace?: boolean;

  @IsNumber()
  @IsOptional()
  commissionPercent?: number;

  @IsString()
  @IsOptional()
  affiliationType?: string;

  @IsString()
  @IsOptional()
  materialLink?: string;

  @IsString()
  @IsOptional()
  coproductionEmail?: string;

  @IsNumber()
  @IsOptional()
  coproductionPercent?: number;

  @IsOptional()
  content?: any;
}