import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefixo global para todas as rotas
  app.setGlobalPrefix('api/v1');

  // Configuração de CORS CORRIGIDA
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
      'https://paylure.com.br',
      'https://www.paylure.com.br',
      'https://api.paylure.com.br',
      'https://paylure.vercel.app',
    ],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Segurança
  app.use(helmet());
  app.use(cookieParser());

  // Validação automática de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  
  // Ouvir em 0.0.0.0 para Docker
  await app.listen(port, '0.0.0.0');
  
  console.log(`🚀 Backend rodando em http://0.0.0.0:${port}`);
  console.log(`📡 API disponível em /api/v1`);
}
bootstrap();