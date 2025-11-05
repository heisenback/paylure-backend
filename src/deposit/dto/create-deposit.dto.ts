// src/deposit/dto/create-deposit.dto.ts
import { IsNumber, IsNotEmpty, IsPositive } from 'class-validator';

export class CreateDepositDto {
  @IsNumber({}, { message: 'O valor do depósito deve ser um número.' })
  @IsPositive({ message: 'O valor do depósito deve ser positivo.' })
  @IsNotEmpty({ message: 'O valor do depósito é obrigatório.' })
  amount: number; // Valor em CENTAVOS (ex: 1000 = R$ 10,00)
}