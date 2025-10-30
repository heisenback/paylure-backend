// src/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. CONFIGURAÇÃO BASE (Melhora a segurança e tipagem)
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, 
    forbidNonWhitelisted: true, 
    transform: true, 
  }));
  
  // 2. PREFIXO GLOBAL DE ROTAS
  app.setGlobalPrefix('api');
  
  // 3. CONFIGURAÇÃO DE CORS (O Ajuste Crítico de Segurança e Conexão)
  
  // 🚨 CORRIGIDO: Agora usando seu domínio real do Vercel!
  const allowedOrigins = [
      'https://paylure.vercel.app', // <--- SEU DOMÍNIO VERCEL CORRIGIDO!
      'http://localhost:3000',      // Dev local do Backend
      'http://localhost:3001'       // Dev local do Frontend (ou a porta que você usa)
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
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', 
    credentials: true,
  });

  // 4. INICIALIZAÇÃO DO SERVIDOR NA VPS
  const PORT = process.env.PORT || 3000;
  
  // '0.0.0.0' é fundamental para escutar conexões externas na sua VPS.
  await app.listen(PORT, '0.0.0.0'); 
  
  console.log(`🚀 Gateway de Pagamento (NestJS) rodando em http://0.0.0.0:${PORT}/api`);
}
bootstrap();