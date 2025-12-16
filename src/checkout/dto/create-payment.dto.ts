import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsObject, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  document: string; // CPF ou CNPJ

  @IsString()
  @IsNotEmpty()
  phone: string;
}

class ItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  // ✅ CORREÇÃO: title agora é opcional ou validado com cuidado
  // Se o frontend antigo não manda title, podemos deixar @IsOptional() ou garantir que venha.
  // Vou manter obrigatório, mas vamos garantir que o frontend envie.
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsNumber()
  @IsNotEmpty()
  price: number;
}

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  // ✅ ESSENCIAIS PARA O BUILD NÃO QUEBRAR
  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsString()
  ref?: string; // ID do afiliado (promoterId)

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;
}