// src/payment-link/dto/create-payment-link.dto.ts
import { IsNotEmpty, IsString, IsInt, IsPositive } from 'class-validator';

export class CreatePaymentLinkDto {
  @IsString()
  @IsNotEmpty({ message: 'O título (title) é obrigatório.' })
  title: string;

  @IsInt({ message: 'O valor (amount) deve ser um número inteiro.' })
  @IsPositive({ message: 'O valor (amount) deve ser um número positivo.' })
  @IsNotEmpty({ message: 'O valor (amount) é obrigatório.' })
  // Lembrete: este valor é em CENTAVOS. (Ex: R$ 10,00 = 1000)
  amount: number;
}