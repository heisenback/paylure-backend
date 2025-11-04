import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// 🚨 CORREÇÃO: Importar 'helmet' como default
import helmet from 'helmet';

// 🚨 CORREÇÃO: Importar 'cookie-parser' como default (sem o * as)
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // --- CORREÇÕES DEPLOY FINAL ---

  // 1. CORREÇÃO DE ROTA 404: Define o prefixo global
  app.setGlobalPrefix('api');

  // 2. CORREÇÃO DE CORS: Permite a conexão do Frontend
  app.enableCors({
    origin: [
      'https://paylure.com.br',       // 👈 FRONT Principal
      'https://www.paylure.com.br',
      'https://api.paylure.com.br',
      'https://paylure.vercel.app',  // 👈 Vercel (se ainda usar)
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
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // 3. PACOTES DE SEGURANÇA (Agora importados corretamente)
  app.use(helmet());
  app.use(cookieParser());

  // --- FIM DAS CORREÇÕES ---
  
  const port = process.env.PORT || 3000;
  
  // 🚨 CORREÇÃO CRÍTICA (DOCKER): Ouvir em '0.0.0.0'
  await app.listen(port, '0.0.0.0'); 
  
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`📡 API disponível em /api`);
}
bootstrap();