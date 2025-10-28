// src/merchant/dto/create-merchant.dto.ts
import { IsNotEmpty, IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateMerchantDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome da loja (storeName) é obrigatório.' })
  storeName: string;

  @IsString()
  @IsNotEmpty({ message: 'O CNPJ é obrigatório.' })
  cnpj: string;

  // Os campos abaixo são opcionais na criação
  @IsUrl({}, { message: 'O logoUrl deve ser um link (URL) válido.' })
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  pixKey?: string;
}