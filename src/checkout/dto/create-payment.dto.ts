import { IsString, IsNotEmpty, IsOptional, ValidateNested, IsNumber, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  document?: string; // Pode vir vazio se o seller ocultou

  @IsString()
  @IsOptional()
  phone?: string;
}

class OrderBumpItemDto {
  @IsString()
  id: string;
  
  @IsNumber()
  price: number;
}

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @IsArray()
  @IsOptional()
  items?: OrderBumpItemDto[]; // Para somar os Order Bumps
}