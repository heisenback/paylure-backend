import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = Number(process.env.PORT) || 3000;

  // Importante em container
  await app.listen(port, '0.0.0.0');
}
bootstrap();
