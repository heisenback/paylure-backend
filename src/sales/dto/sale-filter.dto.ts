// src/sales/dto/sale-filter.dto.ts
import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';

export enum SaleStatus {
  PAID = 'PAID',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export class SaleFilterDto {
  @IsOptional()
  @IsEnum(SaleStatus, { message: 'Status de venda inválido.' })
  status?: SaleStatus;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string; // Filtro por data inicial (ISO 8601)

  @IsOptional()
  @IsDateString()
  endDate?: string; // Filtro por data final (ISO 8601)
  
  @IsOptional()
  @IsString()
  search?: string; // Busca por email ou documento
}