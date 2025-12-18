// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // necessário pra assinatura de webhooks (corpo raw)
    rawBody: true,
  });

  // o frontend consome /api/v1/...
  app.setGlobalPrefix('api/v1');
  logger.log('✅ Prefixo global configurado: /api/v1');

  /**
   * ✅ CORS (Vercel -> VPS)
   * IMPORTANTE: com credentials:true, NÃO pode usar "*"
   * Você pode controlar via ENV:
   * CORS_ORIGINS="https://paylure.com.br,https://www.paylure.com.br,http://localhost:3000"
   */
  const allowedOrigins = (process.env.CORS_ORIGINS ??
    'https://paylure.com.br,https://www.paylure.com.br,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // sem origin = server-to-server / curl / healthcheck
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS bloqueado para origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Requested-With',
      'Origin',
      // se você assina webhooks/gateway
      'x-keyclub-signature',
    ],
    optionsSuccessStatus: 204,
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
  logger.log(`🔐 CORS liberado para: ${allowedOrigins.join(', ')}`);
  logger.log('🚀 ====================================');
}
bootstrap();
