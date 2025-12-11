import { IsOptional, IsString, IsNumber, IsObject } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsObject()
  checkoutConfig?: any; // Recebe a configuração visual completa
}