import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Prefixo global (mantém sua rota /api/v1/...)
  const globalPrefix = process.env.GLOBAL_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(globalPrefix);

  // CORS – autorize seu domínio e o subdomínio da API
  const allowedOrigins = new Set<string>([
    'https://paylure.com.br',
    'https://www.paylure.com.br',
    'https://api.paylure.com.br',
    'http://localhost:5173',  // dev opcional
    'http://localhost:3000',  // dev opcional
  ]);

  app.enableCors({
    origin: (origin, cb) => {
      // Permite chamadas sem origin (ex.: healthchecks) e as que estiverem na lista
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error('CORS: origem não autorizada'), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-Requested-With, Accept',
    credentials: true,
    optionsSuccessStatus: 204,
  });

  // Pipes globais
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Porta e host
  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
  // console.log(`API ouvindo em ${await app.getUrl()}`); // opcional
}

bootstrap();
