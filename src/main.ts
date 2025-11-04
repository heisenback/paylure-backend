import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 👉 Define o prefixo global para todas as rotas
  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: [
      'https://paylure.com.br',       // 👈 FRONT Principal
      'https://www.paylure.com.br',
      'https://app.paylure.com.br',
      'https://api.paylure.com.br',
      'http://localhost:3000',        // 👈 Desenvolvimento local
      'http://localhost:5173',        // 👈 Vite local
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
    preflightContinue: false, // Nest responde o OPTIONS automaticamente
    optionsSuccessStatus: 204,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
  console.log(`📡 API disponível em http://localhost:${port}/api/v1`);
}
bootstrap();