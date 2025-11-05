import { IsNotEmpty, IsNumber, IsString, Min, IsIn } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(100, { message: 'Valor mínimo para saque é R$ 1,00 (100 centavos).' })
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'A chave PIX é obrigatória.' })
  pix_key: string;

  @IsString()
  @IsNotEmpty({ message: 'O tipo de chave PIX é obrigatório.' })
  @IsIn(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'], {
    message: 'Tipo de chave inválido. Use: CPF, CNPJ, EMAIL, PHONE ou RANDOM.',
  })
  key_type: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';

  @IsString()
  description?: string;
}