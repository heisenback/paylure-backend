import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterAuthDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  name?: string; // <-- ADICIONADO

  @IsString()
  @IsOptional()
  storeName?: string; // <-- ADICIONADO

  @IsString()
  @IsOptional()
  cnpj?: string; // <-- ADICIONADO
}
