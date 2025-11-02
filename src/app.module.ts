import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // Importar ConfigModule
import { AppController } from './app.controller';
import { AppService } from './app.service';
// Importe os outros módulos do seu projeto aqui (ex: AuthModule, DepositModule, etc.)

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Torna as variáveis de ambiente acessíveis globalmente
    }),
    // Adicione seus outros módulos aqui
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
