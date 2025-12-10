import { IsEmail, IsString, MinLength, IsNotEmpty, IsOptional } from 'class-validator';

export class RegisterAuthDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'O nome é obrigatório' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'O nome de usuário é obrigatório' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'O CPF é obrigatório' })
  document: string; // 🔒 AGORA É OBRIGATÓRIO

  @IsString()
  @IsNotEmpty({ message: 'O WhatsApp é obrigatório' })
  whatsapp: string; // 🔒 NOVO CAMPO OBRIGATÓRIO

  @IsString()
  @IsOptional()
  storeName?: string;

  @IsString()
  @IsOptional()
  cnpj?: string;
}