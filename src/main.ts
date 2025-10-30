// src/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. CONFIGURAÇÃO BASE
  // Liga a validação automática para todos os DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Remove propriedades que não existem no DTO
    forbidNonWhitelisted: true, // Retorna erro se receber propriedades não esperadas
    transform: true, // Converte tipos automaticamente (ex: '123' para 123)
  }));
  
  // 2. PREFIXO GLOBAL DE ROTAS (Boa Prática)
  app.setGlobalPrefix('api'); // Todas as suas rotas agora serão /api/...
  
  // 3. CONFIGURAÇÃO DE CORS (O Ajuste Crítico de Segurança e Conexão)
  
  // 🚨 ATENÇÃO: SUBSTITUA O DOMÍNIO FALSO ABAIXO PELO SEU ENDEREÇO REAL DO VERCEL!
  const allowedOrigins = [
      'https://seu-dominio-vercel-real.vercel.app', // <--- SUBSTITUA AQUI!
      'http://localhost:3000',                      // Dev local do Backend
      'http://localhost:3001'                       // Dev local do Frontend (ou a porta que você usa)
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Permite requisições de serviços (sem 'origin') ou se estiver na lista
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // Bloqueia e loga (sem expor a mensagem completa no log do cliente)
        console.error(`CORS BLOCKED: Origin ${origin} not in whitelist.`);
        callback(new Error('Not allowed by CORS policy.'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Métodos HTTP permitidos
    credentials: true, // Permite o envio de cookies/auth headers
  });

  // 4. INICIALIZAÇÃO DO SERVIDOR NA VPS
  const PORT = process.env.PORT || 3000;
  
  // '0.0.0.0' é fundamental para que o servidor escute conexões externas na sua VPS.
  await app.listen(PORT, '0.0.0.0'); 
  
  console.log(`🚀 Gateway de Pagamento (NestJS) rodando em http://0.0.0.0:${PORT}/api`);
}
bootstrap();