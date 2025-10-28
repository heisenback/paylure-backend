// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Liga a validação automática para todos os DTOs
  app.useGlobalPipes(new ValidationPipe());

  // ======================================================
  // AQUI ESTÁ A CORREÇÃO:
  // Isso dá o "Alvará de Permissão" (CORS) para
  // que o http://localhost:3001 possa "falar" com a gente.
  app.enableCors();
  // ======================================================

  await app.listen(3000);
}
bootstrap();