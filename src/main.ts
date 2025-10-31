// src/main.ts (CORRIGIDO)

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. CONFIGURAÇÃO BASE (Melhora a segurança e tipagem)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 2. PREFIXO GLOBAL DE ROTAS (IMPORTANTE!)
  app.setGlobalPrefix('api');

  // 3. CONFIGURAÇÃO DE CORS (O Ajuste Crítico de Segurança e Conexão)

  // 🚨 AJUSTE: Incluímos portas locais adicionais para o teste (3000, 3001, 4000)
  const allowedOrigins = [
    'https://paylure.vercel.app', // Mantido para quando o Vercel estiver pronto para HTTPS
    'http://localhost:3000', // Dev local comum
    'http://localhost:3001', // Dev local Next.js padrão
    'http://localhost:4000', // Outra porta comum de dev
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
  // ================== CORREÇÃO AQUI ==================
  // Mudamos a porta para 3333 para fugir do conflito de SSL na porta 3000
  const PORT = process.env.PORT || 3333;
  // ================== FIM DA CORREÇÃO ================

  // '0.0.0.0' é fundamental para escutar conexões externas na sua VPS.
  await app.listen(PORT, '0.0.0.0');

  console.log(
    `🚀 Gateway de Pagamento (NestJS) rodando em http://0.0.0.0:${PORT}/api`,
  );
}
bootstrap();