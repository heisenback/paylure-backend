// src/marketplace/dto/create-marketplace-product.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min, Max, IsIn } from 'class-validator';

export class CreateMarketplaceProductDto {
  @IsString()
  @IsNotEmpty({ message: 'O ID do produto é obrigatório.' })
  productId: string;

  @IsNumber()
  @Min(1, { message: 'A comissão mínima é de 1%.' })
  @Max(100, { message: 'A comissão máxima é de 100%.' })
  commissionRate: number; // Porcentagem de 1 a 100

  @IsString()
  @IsNotEmpty({ message: 'O tipo de atribuição é obrigatório.' })
  @IsIn(['LAST_CLICK', 'FIRST_CLICK'], { message: 'Tipo de atribuição inválido.' })
  attributionType: string;

  // O Merchant ID será injetado pelo controller para segurança
  merchantId?: string; 
}