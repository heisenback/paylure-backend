// src/checkout/dto/create-payment.dto.ts
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsObject, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  // ✅ CORREÇÃO: Mudamos para IsOptional para permitir "Esconder" no checkout
  @IsOptional()
  @IsString()
  document?: string; 

  // ✅ CORREÇÃO: Mudamos para IsOptional
  @IsOptional()
  @IsString()
  phone?: string;
}

class ItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  // ✅ CORREÇÃO: IsOptional, pois se vier vazio pegamos o nome do produto no banco
  @IsOptional()
  @IsString()
  title?: string;

  @IsNumber()
  @IsNotEmpty()
  price: number;
}

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsString()
  ref?: string; // ID do afiliado

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;
}