// src/push-notification/push-notification.controller.ts
import { 
  Controller, 
  Post, 
  Delete, 
  Body, 
  Param, 
  HttpCode, 
  HttpStatus,
  Logger 
} from '@nestjs/common';
import { PushNotificationService } from './push-notification.service';
import { SubscribeDto } from './dto/subscribe.dto';

@Controller('api/v1/push-notifications')
export class PushNotificationController {
  private readonly logger = new Logger(PushNotificationController.name);

  constructor(private readonly pushService: PushNotificationService) {}

  @Post('subscribe/:userId')
  @HttpCode(HttpStatus.CREATED)
  async subscribe(
    @Param('userId') userId: string,
    @Body() dto: SubscribeDto,
  ) {
    try {
      await this.pushService.subscribe(userId, dto.subscription, dto.deviceInfo);
      return { 
        success: true, 
        message: 'Inscrito com sucesso nas notificações push.' 
      };
    } catch (error) {
      this.logger.error('Erro ao inscrever em push notifications', error);
      throw error;
    }
  }

  @Delete('unsubscribe/:userId')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @Param('userId') userId: string,
    @Body('endpoint') endpoint: string,
  ) {
    try {
      await this.pushService.unsubscribe(userId, endpoint);
      return { 
        success: true, 
        message: 'Inscrição cancelada com sucesso.' 
      };
    } catch (error) {
      this.logger.error('Erro ao cancelar inscrição', error);
      throw error;
    }
  }

  @Post('test/:userId')
  @HttpCode(HttpStatus.OK)
  async testNotification(@Param('userId') userId: string) {
    try {
      await this.pushService.sendNotification(userId, {
        title: '🔔 Teste de Notificação',
        body: 'Esta é uma notificação de teste do Paylure.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        data: { 
          type: 'TEST',
          url: '/dashboard' 
        },
      });
      return { 
        success: true, 
        message: 'Notificação de teste enviada.' 
      };
    } catch (error) {
      this.logger.error('Erro ao enviar notificação de teste', error);
      throw error;
    }
  }
}