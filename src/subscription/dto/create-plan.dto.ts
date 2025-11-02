// src/subscription/dto/create-plan.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min, IsIn, IsOptional } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome do plano é obrigatório.' })
  name: string;

  @IsNumber()
  @Min(0.01, { message: 'O preço deve ser no mínimo R$ 0,01.' })
  price: number; // Valor em BRL, será convertido para centavos no Service

  @IsString()
  @IsNotEmpty({ message: 'O intervalo de cobrança é obrigatório.' })
  @IsIn(['MONTHLY', 'ANNUALLY', 'WEEKLY'], { message: 'Intervalo inválido.' })
  interval: string;

  @IsNumber()
  @IsOptional()
  @Min(0, { message: 'O período de teste não pode ser negativo.' })
  trialPeriodDays?: number;

  // O merchantId será injetado pelo controller
  merchantId?: string; 
}