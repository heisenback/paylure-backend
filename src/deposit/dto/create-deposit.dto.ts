// src/deposit/dto/create-deposit.dto.ts
import { IsNumber, IsOptional, IsString, IsEmail, Min } from 'class-validator';

export class CreateDepositDto {
  // Valor em BRL (ex.: 100 => R$100,00)
  @IsNumber()
  @Min(1)
  amount: number;

  // ------ FORMATO ANTIGO (compat) ------
  @IsOptional() @IsString() userName?: string;
  @IsOptional() @IsEmail()  userEmail?: string;
  @IsOptional() @IsString() userDocument?: string;
  @IsOptional() @IsString() phone?: string;

  // ------ FORMATO NOVO ------
  @IsOptional() @IsString() payerName?: string;
  @IsOptional() @IsEmail()  payerEmail?: string;
  @IsOptional() @IsString() payerDocument?: string;
  @IsOptional() @IsString() payerPhone?: string;

  // Opcionais
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() callbackUrl?: string;
}