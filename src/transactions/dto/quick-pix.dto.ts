// src/transactions/dto/quick-pix.dto.ts
import { IsNumber, IsString, IsEmail, Min, IsNotEmpty } from 'class-validator';

export class QuickPixDto {
  @IsNumber()
  @Min(1.00, { message: 'O valor mínimo para cobrança é R$ 1,00.' })
  amount: number; // Valor da cobrança EM REAIS

  @IsString()
  @IsNotEmpty()
  payerName: string; // Nome do pagador final

  @IsEmail()
  @IsNotEmpty()
  payerEmail: string; // E-mail do pagador final

  @IsString()
  @IsNotEmpty()
  payerDocument: string; // CPF/CNPJ do pagador final
}