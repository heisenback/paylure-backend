// src/deposit/dto/create-deposit.dto.ts
import { IsNumber, IsNotEmpty, IsPositive } from 'class-validator';

// 🚨 CORREÇÃO PRINCIPAL: Adicionado 'amount' e removido/comentado campos não usados
export class CreateDepositDto {
  @IsNumber({}, { message: 'O valor do depósito deve ser um número.' })
  @IsPositive({ message: 'O valor do depósito deve ser positivo.' })
  @IsNotEmpty({ message: 'O valor do depósito é obrigatório.' })
  amount: number; // Agora o DTO tem o campo que o service espera!
  
  /*
  // Campos abaixo não são mais necessários para a geração direta de PIX no Dashboard
  @IsString()
  @IsNotEmpty({ message: 'O slug (ID do link de pagamento) é obrigatório.' })
  slug: string; 

  @IsString()
  @IsNotEmpty({ message: 'O nome do pagador é obrigatório.' })
  payerName: string;

  @IsString()
  @IsEmail({}, { message: 'E-mail do pagador inválido.' })
  payerEmail: string;

  @IsString()
  @IsNotEmpty({ message: 'Documento (CPF/CNPJ) do pagador é obrigatório.' })
  payerDocument: string;
  */
} 