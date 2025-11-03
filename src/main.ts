import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule); 

  // 🚨 CORREÇÃO CRÍTICA PARA CORS:
  // Definir uma lista branca (whitelist) de origens para permitir a conexão HTTPS do Vercel.
  const allowedOrigins = [
    // Seu domínio de produção seguro
    'https://paylure.com.br', 
    'https://api.paylure.com.br', 
    
    // O domínio de deploy do Vercel (onde está hospedado)
    'https://paylure.vercel.app', 
    
    // Locais de desenvolvimento
    'http://localhost:3000',
    'http://localhost:3001', 
  ];

  app.enableCors({
    // Função de verificação de origem
    origin: (origin, callback) => {
      // Permitir requisições sem origem (ex: Postman, ou requisições internas)
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