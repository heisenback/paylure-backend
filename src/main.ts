// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // Cria a aplicação
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Necessário para Webhooks
  });

  // 🔴 REMOVIDO O PREFIXO GLOBAL
  // Antes estava 'api/v1', mas seu frontend chama direto na raiz.
  // Se quiser usar versionamento no futuro, precisa atualizar o frontend também.
  // app.setGlobalPrefix('api/v1'); 

  // 👇 CONFIGURAÇÃO DE CORS SIMPLIFICADA E PERMISSIVA
  // Isso resolve 99% dos problemas de conexão frontend <-> backend
  app.enableCors({
    origin: true, // Permite qualquer origem que envie credenciais (Reflete a origem da requisição)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true, // Permite cookies/headers de autorização
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With, Origin, x-keyclub-signature',
  });
  
  logger.log('✅ CORS habilitado (origin: true)');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log('');
  logger.log('🚀 ====================================');
  logger.log(`🚀 Backend rodando em http://0.0.0.0:${port}`);
  // logger.log(`🌐 API disponível em http://0.0.0.0:${port}/api/v1`); // Removido log antigo
  logger.log('🚀 ====================================');
}
bootstrap();