// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    rawBody: true, 
  });

  // 👇 AQUI ESTAVA O DETALHE! 
  // O seu Frontend está mandando '/api/v1', então precisamos dessa linha ativa.
  app.setGlobalPrefix('api/v1');
  logger.log('✅ Prefixo global configurado: /api/v1');

  // 👇 CORS SIMPLIFICADO (Funcionou perfeitamente no seu teste)
  app.enableCors({
    origin: true, 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With, Origin, x-keyclub-signature',
  });
  
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
  logger.log(`🌐 API disponível em http://0.0.0.0:${port}/api/v1`);
  logger.log('🚀 ====================================');
}
bootstrap();