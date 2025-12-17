// src/report/dto/report-filter.dto.ts
import { IsString, IsOptional, IsDateString } from 'class-validator';

export class ReportFilterDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}