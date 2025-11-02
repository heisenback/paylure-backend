// src/membership/dto/create-integration.dto.ts
import { IsString, IsNotEmpty, IsUrl, IsOptional, IsIn } from 'class-validator';

export class CreateIntegrationDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome da integração é obrigatório.' })
  name: string;

  @IsUrl({}, { message: 'A URL do Webhook deve ser um endereço válido.' })
  @IsNotEmpty({ message: 'A URL do Webhook é obrigatória.' })
  webhookUrl: string;

  @IsString()
  @IsIn(['MEMBERKIT', 'HOTMART_CLUB', 'MOCK', 'OTHER'], { message: 'Plataforma de membros inválida.' })
  platform: string;

  @IsString()
  @IsOptional()
  secretKey?: string;
  
  // O merchantId será injetado pelo controller/guard, mas é bom tê-lo no tipo
  merchantId?: string; 
}