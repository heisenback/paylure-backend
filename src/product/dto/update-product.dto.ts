// src/product/dto/update-product.dto.ts
import { IsOptional, IsString, IsNumber, IsObject, Min } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // ✅ PADRONIZAÇÃO: Aceita SOMENTE 'price' em Reais (igual ao Create)
  // O Service converte para centavos.
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  price?: number;

  @IsOptional()
  @IsObject()
  checkoutConfig?: any;
}