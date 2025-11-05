import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterAuthDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  username?: string; // ✅ ADICIONADO - Nome de usuário do frontend

  @IsString()
  @IsOptional()
  document?: string; // ✅ ADICIONADO - CPF/CNPJ do usuário

  @IsString()
  @IsOptional()
  storeName?: string;

  @IsString()
  @IsOptional()
  cnpj?: string;
}