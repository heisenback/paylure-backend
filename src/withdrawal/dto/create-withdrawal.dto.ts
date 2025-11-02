// src/withdrawal/dto/create-withdrawal.dto.ts
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(100) // R$ 1,00 em centavos
  @IsNotEmpty()
  amount: number; // Em centavos 

  @IsString()
  @IsNotEmpty()
  pix_key: string; 

  @IsString()
  @IsNotEmpty()
  key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM'; 

  @IsString()
  description?: string; 
}