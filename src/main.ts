import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Inicializa o NestJS sem o objeto { cors: true }
  const app = await NestFactory.create(AppModule); 

  // Habilitar CORS explicitamente para *QUALQUER* origem.
  // Isso garante que o CORS não está bloqueando, mesmo se o Vercel for a origem.
  // ATENÇÃO: Use 'origin: "*"' apenas em ambientes de teste.
  app.enableCors({
    origin: '*', 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  
  const port = Number(process.env.PORT) || 3000;

  // Importante em container para ouvir em todas as interfaces
  await app.listen(port, '0.0.0.0');
}
bootstrap();