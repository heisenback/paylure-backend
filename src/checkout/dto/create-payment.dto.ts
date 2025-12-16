// src/checkout/dto/create-payment.dto.ts
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  document: string; // CPF ou CNPJ

  @IsString()
  @IsNotEmpty()
  phone: string;
}

class ItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  title: string;

  @IsNotEmpty()
  price: number;
}

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  // ✅ CORREÇÃO: Campos novos adicionados para o afiliado/oferta funcionar
  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsString()
  ref?: string; // ID do afiliado (promoterId)

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;
}