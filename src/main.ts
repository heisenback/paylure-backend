import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  logger.log('✅ Prefixo global configurado: /api/v1');

  // Configuração CORS completa
  app.enableCors({
    origin: true, // Aceita qualquer origem
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  logger.log('✅ CORS habilitado');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  logger.log('✅ Validação global configurada');

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log('');
  logger.log('🚀 ====================================');
  logger.log(`🚀 Backend rodando em http://0.0.0.0:${port}`);
  logger.log(`🌐 API disponível em http://0.0.0.0:${port}/api/v1`);
  logger.log('🚀 ====================================');
  logger.log('');
  logger.log('📚 Rotas disponíveis:');
  logger.log('   GET  /api/v1/health');
  logger.log('   POST /api/v1/auth/register');
  logger.log('   POST /api/v1/auth/login');
  logger.log('   GET  /api/v1/auth/me');
  logger.log('');
}
bootstrap();