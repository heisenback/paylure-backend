import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule); 

  // 🚨 CORREÇÃO FINAL PARA CORS:
  // Definir uma lista branca (whitelist) de todas as origens permitidas.
  // Isso resolve o erro "No 'Access-Control-Allow-Origin' header is present".
  const allowedOrigins = [
    // Seu domínio de produção (FRONTEND)
    'https://paylure.com.br', 
    'https://www.paylure.com.br', 
    
    // Seu domínio da API (para debug e consistência)
    'https://api.paylure.com.br', 
    
    // O domínio de deploy do Vercel (onde está hospedado)
    'https://paylure.vercel.app', 
    
    // Locais de desenvolvimento
    'http://localhost:3000',
    'http://localhost:3001', 
    // Você pode adicionar outras portas de desenvolvimento aqui se usar.
  ];

  app.enableCors({
    // Função de verificação de origem
    origin: (origin, callback) => {
      // Permitir requisições sem origem (ex: Postman)
      // OU se a origem estiver na lista branca
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // Bloquear qualquer outra origem
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    // Incluir o método OPTIONS é crucial para requisições CORS complexas (preflight checks)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS', 
    credentials: true, // Necessário se você estiver usando cookies ou tokens de autenticação
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });
  
  const port = Number(process.env.PORT) || 3000;

  // Importante em container para ouvir em todas as interfaces
  await app.listen(port, '0.0.0.0');
}
bootstrap();