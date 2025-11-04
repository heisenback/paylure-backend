import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // 1. Cria a aplicação SEM NENHUMA configuração de CORS.
  // Isso resolve o conflito com o Nginx Proxy Manager.
  const app = await NestFactory.create(AppModule); 

  // 🚨 LINHAS DE CORS REMOVIDAS: app.enableCors({...})
  // Deixamos o Nginx tratar os cabeçalhos, eliminando a duplicidade e o erro 502.
  
  const port = Number(process.env.PORT) || 3000;

  // 2. Importante em container: ouvir em todas as interfaces
  await app.listen(port, '0.0.0.0');
}

bootstrap();