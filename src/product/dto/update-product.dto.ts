// src/product/dto/update-product.dto.ts
import { IsOptional, IsString, IsNumber, IsObject, Min, IsBoolean } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  price?: number;

  @IsOptional()
  @IsObject()
  checkoutConfig?: any;

  // --- NOVOS CAMPOS PARA ATUALIZAÇÃO ---
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  deliveryMethod?: string;

  @IsOptional()
  @IsString()
  paymentType?: string;

  @IsOptional()
  @IsString()
  subscriptionPeriod?: string;

  @IsOptional()
  @IsString()
  deliveryUrl?: string;

  @IsOptional()
  @IsString()
  file?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsBoolean()
  isAffiliationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  showInMarketplace?: boolean;

  @IsOptional()
  @IsNumber()
  commissionPercent?: number;

  @IsOptional()
  @IsString()
  affiliationType?: string;

  @IsOptional()
  @IsString()
  materialLink?: string;

  @IsOptional()
  @IsString()
  coproductionEmail?: string;

  @IsOptional()
  @IsNumber()
  coproductionPercent?: number;

  @IsOptional()
  content?: any;
}