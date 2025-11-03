import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // 1. CONFIGURAÇÃO BASE (Pipes e Validação)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false, 
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // 2. PREFIXO GLOBAL DE ROTAS
  // Assumimos que o prefixo /api/v1 é o correto
  app.setGlobalPrefix('api/v1');

  // 3. CONFIGURAÇÃO DE CORS (O Ajuste Crítico de Segurança e Conexão)
  const allowedOrigins = [
    'https://paylure.vercel.app', // Frontend em Produção (Vercel)
    'http://62.171.175.190:3000',      // Seu IP de VPS (para acesso direto)
    'http://localhost:3000', 
    'http://localhost:3001', 
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`CORS BLOCKED: Origin ${origin} not in whitelist.`);
        callback(new Error('Not allowed by CORS policy.'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 4. INICIALIZAÇÃO
  // Lê a porta da variável de ambiente PORT (que está no .env)
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
