import { IsEmail, IsString, MinLength, IsNotEmpty, IsOptional } from 'class-validator';

export class RegisterAuthDto {
  @IsEmail({}, { message: 'Insira um e-mail válido' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'O nome é obrigatório' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'O nome de usuário é obrigatório' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'O CPF é obrigatório' })
  document: string; 

  @IsString()
  @IsNotEmpty({ message: 'O WhatsApp é obrigatório' })
  whatsapp: string;

  @IsString()
  @IsOptional()
  storeName?: string;

  @IsString()
  @IsOptional()
  cnpj?: string;

  // ✅ NOVO CAMPO: Essencial para o sistema de indicação funcionar
  @IsString()
  @IsOptional()
  referralCode?: string;
}