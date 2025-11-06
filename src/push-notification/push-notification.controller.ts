// src/push-notification/push-notification.controller.ts
import { Controller, Post, Delete, Body, UseGuards, Req, Get } from '@nestjs/common';
import { PushNotificationService } from './push-notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscribeDto } from './dto/subscribe.dto';

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushNotificationController {
  constructor(private readonly pushService: PushNotificationService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
    };
  }

  @Post('subscribe')
  async subscribe(@Req() req: any, @Body() dto: SubscribeDto) {
    const userId = req.user.id;
    return this.pushService.subscribe(userId, dto.subscription, dto.deviceInfo);
  }

  @Delete('unsubscribe')
  async unsubscribe(@Req() req: any, @Body() body: { endpoint: string }) {
    const userId = req.user.id;
    await this.pushService.unsubscribe(userId, body.endpoint);
    return { success: true };
  }
}