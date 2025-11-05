// ========================================
// src/deposit/dto/create-deposit.dto.ts
// ========================================
import { IsNumber, IsNotEmpty, IsPositive } from 'class-validator';

export class CreateDepositDto {
  @IsNumber({}, { message: 'O valor do depósito deve ser um número.' })
  @IsPositive({ message: 'O valor do depósito deve ser positivo.' })
  @IsNotEmpty({ message: 'O valor do depósito é obrigatório.' })
  amount: number; // Valor em CENTAVOS (ex: 1000 = R$ 10,00)
}

// ========================================
// src/withdrawal/dto/create-withdrawal.dto.ts
// ========================================
import { IsNotEmpty, IsNumber, IsString, Min, IsIn } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(100, { message: 'Valor mínimo para saque é R$ 1,00 (100 centavos).' })
  @IsNotEmpty()
  amount: number; // Valor em CENTAVOS (ex: 1000 = R$ 10,00)

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