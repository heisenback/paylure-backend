// src/affiliate/dto/request-affiliate.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RequestAffiliateDto {
  // ✅ CORREÇÃO: O promoterId vem do token (AuthGuard), não do corpo da requisição.
  // Então ele deve ser opcional na validação de entrada.
  @IsOptional() 
  @IsString()
  promoterId?: string;

  @IsString()
  @IsNotEmpty()
  marketplaceProductId: string;
}