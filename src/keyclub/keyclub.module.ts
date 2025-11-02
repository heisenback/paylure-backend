// src/keyclub/keyclub.module.ts
import { Module } from '@nestjs/common';
import { KeyclubService } from './keyclub.service';
import { KeyclubController } from './keyclub.controller'; // Importa o Controller que movemos
import { WebhooksModule } from 'src/webhooks/webhooks.module'; // Importa o módulo que tem o WebhooksService

@Module({
  imports: [
    WebhooksModule, // Importamos o módulo que exporta o WebhooksService
  ],
  providers: [KeyclubService],
  // REGISTRA O CONTROLLER AQUI!
  controllers: [KeyclubController], 
  exports: [KeyclubService], 
})
export class KeyclubModule {}