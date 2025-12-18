// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    rawBody: true, 
  });

  // 🔴 REMOVIDO O PREFIXO 'api/v1' 
  // O seu frontend chama "api.paylure.com.br/auth/..." direto.
  // Se deixarmos o 'api/v1', o navegador recebe erro 404 e reclama de CORS.

  // 👇 CONFIGURAÇÃO DE CORS SIMPLIFICADA
  app.enableCors({
    origin: true, 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
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

  logger.log(`🚀 Backend rodando em http://0.0.0.0:${port}`);
}
bootstrap();