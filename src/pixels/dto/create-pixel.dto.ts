// src/pixels/dto/create-pixel.dto.ts
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsBoolean, IsObject } from 'class-validator';

export enum PixelPlatform {
  FACEBOOK = 'FACEBOOK',
  GOOGLE = 'GOOGLE',
  TIKTOK = 'TIKTOK',
  KWAI = 'KWAI',
  PINTEREST = 'PINTEREST',
  UTMIFY = 'UTMIFY',
}

export class CreatePixelDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(PixelPlatform)
  platform: PixelPlatform;

  @IsString()
  @IsNotEmpty()
  pixelId: string;

  @IsString()
  @IsOptional()
  accessToken?: string;

  @IsString()
  @IsOptional()
  testCode?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsObject()
  events: {
    purchase: boolean;
    initiateCheckout: boolean;
    lead: boolean;
    pixGenerated: boolean;
  };
}