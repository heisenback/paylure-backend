// src/product/dto/create-product.dto.ts
import { IsNotEmpty, IsString, IsNumber, IsInt, IsOptional, IsPositive } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'O título (title) é obrigatório.' })
  title: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsNumber({}, { message: 'O preço (price) deve ser um número.' })
  @IsPositive({ message: 'O preço (price) deve ser positivo.' })
  @IsNotEmpty({ message: 'O preço (price) é obrigatório.' })
  // O Frontend deve enviar o preço em BRL (Ex: 10.50)
  price: number; 
}