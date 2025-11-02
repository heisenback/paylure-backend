// src/payment-link/dto/create-payment-link.dto.ts
import { IsString, IsNotEmpty, IsNumber, IsUUID } from 'class-validator';

export class CreatePaymentLinkDto {
  // --- CAMPOS QUE VOCÊ JÁ DEVE TER ---
  @IsString()
  @IsNotEmpty()
  title: string; // O 'name' do link

  @IsNumber()
  amount: number; // O 'amountInCents'

  // --- 🚨 CORREÇÃO: CAMPOS QUE FALTAVAM (TS2339) ---
  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsUUID()
  @IsNotEmpty()
  productId: string;
}