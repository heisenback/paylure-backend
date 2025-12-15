// src/product/dto/update-product.dto.ts
import { IsOptional, IsString, IsNumber, IsObject, Min, IsBoolean, IsArray, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

// Precisamos redefinir ou importar as classes auxiliares para o Update também
class OfferDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  price: number;
}

class CouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsNumber()
  discountPercent: number;
}

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
  @IsString()
  salesPageUrl?: string; // ✅ NOVO

  @IsOptional()
  @IsObject()
  checkoutConfig?: any;

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

  // ✅ LISTAS PARA ATUALIZAÇÃO
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfferDto)
  offers?: OfferDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CouponDto)
  coupons?: CouponDto[];
}