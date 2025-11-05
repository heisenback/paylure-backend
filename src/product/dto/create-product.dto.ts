// src/product/dto/create-product.dto.ts
import { IsNotEmpty, IsNumber, IsString, IsOptional, Min } from 'class-validator';

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
}