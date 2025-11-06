// src/push-notification/dto/subscribe.dto.ts
import { IsObject, IsOptional, IsString } from 'class-validator';

export class SubscribeDto {
  @IsObject()
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}