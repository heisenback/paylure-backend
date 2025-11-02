// src/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Isso faz o NestJS guardar o "corpo cru"
  });

  // 1. CONFIGURAÇÃO BASE (Melhora a segurança e tipagem)
  app.useGlobalPipes(
    new ValidationPipe({
      // Desativamos a verificação estrita que estava bloqueando a requisição
      whitelist: false, 
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // 🚨 CORREÇÃO 1: PREFIXO GLOBAL DE ROTAS
  // Mudamos de 'api' para 'api/v1' para sincronizar com o frontend.
  // Rotas agora são: http://62.171.175.190/api/v1/deposits
  app.setGlobalPrefix('api/v1'); 

  // 🚨 CORREÇÃO 2: CONFIGURAÇÃO DE CORS
  // Adicionamos a origem do Vercel e o IP de VPS para testes
  const allowedOrigins = [
    'https://paylure.vercel.app', // Frontend em Produção (Vercel)
    'http://62.171.175.190',      // Seu IP de VPS (para acesso direto)
    'http://localhost:3000',      // Dev local comum
    'http://localhost:3001',      // Dev local Next.js padrão
    'http://localhost:4000',      // Outra porta comum de dev
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Permite requisições de serviços (sem 'origin') ou se estiver na lista
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // Bloqueia e loga 
        console.error(`CORS BLOCKED: Origin ${origin} not in whitelist.`);
        callback(new Error('Not allowed by CORS policy.'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  
  await app.listen(3000); // Mantenha a porta que seu NestJS usa na VPS
}
bootstrap();