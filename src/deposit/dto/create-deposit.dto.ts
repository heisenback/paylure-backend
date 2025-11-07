// src/deposit/dto/create-deposit.dto.ts
import { IsNumber, IsNotEmpty, IsPositive, IsString, IsEmail, IsOptional } from 'class-validator';

export class CreateDepositDto {
  @IsNumber({}, { message: 'O valor do depósito deve ser um número.' })
  @IsPositive({ message: 'O valor do depósito deve ser positivo.' })
  @IsNotEmpty({ message: 'O valor do depósito é obrigatório.' })
  amount: number;

  @IsString({ message: 'O nome do pagador deve ser uma string.' })
  @IsNotEmpty({ message: 'O nome do pagador é obrigatório.' })
  payerName: string;

  @IsEmail({}, { message: 'O email do pagador deve ser válido.' })
  @IsNotEmpty({ message: 'O email do pagador é obrigatório.' })
  payerEmail: string;

  @IsString({ message: 'O documento do pagador deve ser uma string.' })
  @IsNotEmpty({ message: 'O documento do pagador é obrigatório.' })
  payerDocument: string;

  @IsString()
  @IsOptional()
  externalId?: string;

  @IsString()
  @IsOptional()
  callbackUrl?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}