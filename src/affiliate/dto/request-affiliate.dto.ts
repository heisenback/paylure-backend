// src/affiliate/dto/request-affiliate.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RequestAffiliateDto {
  // ✅ CORREÇÃO: Opcional na validação (o Controller preenche com o token)
  @IsOptional() 
  @IsString()
  promoterId?: string;

  @IsString()
  @IsNotEmpty()
  marketplaceProductId: string;
}