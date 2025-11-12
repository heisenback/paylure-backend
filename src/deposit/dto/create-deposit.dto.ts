// src/deposit/create-deposit.dto.ts
import { IsNumber, IsOptional, IsString, IsEmail, Min } from 'class-validator';

export class CreateDepositDto {
  // Valor em BRL (ex.: 100 => R$100,00)
  @IsNumber()
  @Min(1)
  amount: number;

  // ------ FORMATO ANTIGO (frontend antigo/existente) ------
  @IsOptional() @IsString() userName?: string;
  @IsOptional() @IsEmail() userEmail?: string;
  @IsOptional() @IsString() userDocument?: string; // números com/sem máscara
  @IsOptional() @IsString() phone?: string;

  // ------ FORMATO NOVO (frontend atualizado) ------
  @IsOptional() @IsString() payerName?: string;
  @IsOptional() @IsEmail() payerEmail?: string;
  @IsOptional() @IsString() payerDocument?: string;
  @IsOptional() @IsString() payerPhone?: string;

  // Campos auxiliares/opcionais
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() callbackUrl?: string;
}
