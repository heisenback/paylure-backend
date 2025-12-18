// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Necessário para webhooks (Stripe/Keyclub)
  });

  // 👇 AJUSTE IMPORTANTE SOBRE O PREFIXO
  // Se o seu frontend estiver chamando "api.paylure.com.br/auth/..." e aqui estiver "api/v1",
  // o navegador dará erro de CORS (falso positivo para 404).
  // Certifique-se de que a URL no frontend inclua "/api/v1" ou remova esta linha abaixo.
  app.setGlobalPrefix('api/v1');
  logger.log('✅ Prefixo global configurado: /api/v1');

  // 👇 LISTA DE ORIGENS PERMITIDAS (Adicionado www e localhost:3000)
  const allowedOrigins = [
    'https://paylure.com.br',
    'https://www.paylure.com.br',
    'https://api.paylure.com.br',
    'http://localhost:3000', // Frontend Local
    'http://localhost:3001', // Backend Local
  ];

  // 👇 CONFIGURAÇÃO DE CORS ROBUSTA (Função Callback)
  app.enableCors({
    origin: (origin, callback) => {
      // Permite requisições sem 'origin' (ex: Postman, Webhooks servidor-para-servidor)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`🚫 Bloqueado pelo CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'x-keyclub-signature', // Se usar Keyclub, libere este header
    ],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  logger.log('✅ CORS habilitado com verificação estrita');

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