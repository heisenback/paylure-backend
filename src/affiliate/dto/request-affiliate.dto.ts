import { IsString, IsNotEmpty } from 'class-validator'; // (Ou apenas declare as propriedades)

export class RequestAffiliateDto {
  // --- ADICIONE ESTAS DUAS PROPRIEDADES ---
  @IsString()
  @IsNotEmpty()
  promoterId: string;

  @IsString()
  @IsNotEmpty()
  marketplaceProductId: string;

  // ... (mantenha outras propriedades que você já tenha)
}