// src/auth/dto/register-auth.dto.ts

// Vamos instalar isso no próximo passo.
// É um "validador" que garante que o email é um email de verdade.
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterAuthDto {
  @IsEmail({}, { message: 'O e-mail informado não é válido' })
  @IsNotEmpty({ message: 'O e-mail é obrigatório' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'O nome é obrigatório' })
  name: string;
}