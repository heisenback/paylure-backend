// src/report/dto/report-filter.dto.ts
import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';

export class ReportFilterDto {
  @IsOptional()
  @IsDateString()
  startDate?: string; // Filtro por data inicial (ISO 8601)

  @IsOptional()
  @IsDateString()
  endDate?: string; // Filtro por data final (ISO 8601)
  
  @IsOptional()
  @IsString()
  // Tipo de métrica: Total de Vendas, Faturamento, etc.
  @IsIn(['SALES_VOLUME', 'NET_REVENUE', 'COMMISSION_PAID'])
  metric?: string; 
}