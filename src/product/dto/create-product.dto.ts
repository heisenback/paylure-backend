// src/product/dto/create-product.dto.ts
import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, IsObject, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Sub-classes para validar os itens da lista
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

  @IsString()
  @IsOptional()
  salesPageUrl?: string; // ✅ NOVO: Página de Vendas

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  category?: string;

  // --- ENTREGA & PAGAMENTO ---
  @IsString() @IsOptional() deliveryMethod?: string;
  @IsString() @IsOptional() paymentType?: string;
  @IsString() @IsOptional() subscriptionPeriod?: string;
  @IsString() @IsOptional() deliveryUrl?: string;
  @IsString() @IsOptional() fileUrl?: string;
  @IsString() @IsOptional() fileName?: string;
  @IsObject() @IsOptional() checkoutConfig?: any;

  // --- MARKETPLACE & AFILIAÇÃO ---
  @IsBoolean() @IsOptional() isAffiliationEnabled?: boolean;
  @IsBoolean() @IsOptional() showInMarketplace?: boolean;
  @IsNumber() @IsOptional() commissionPercent?: number;
  @IsString() @IsOptional() affiliationType?: string;
  @IsString() @IsOptional() materialLink?: string;

  // --- CO-PRODUÇÃO ---
  @IsString() @IsOptional() coproductionEmail?: string;
  @IsNumber() @IsOptional() coproductionPercent?: number;

  @IsOptional() content?: any;

  // ✅ NOVAS LISTAS DE OFERTAS E CUPONS
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