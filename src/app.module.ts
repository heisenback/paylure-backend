import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // Importar ConfigModule
import { AppController } from './app.controller';
import { AppService } from './app.service';

// 🚨 CORREÇÃO: Importação dos módulos necessários (adicione o caminho correto)
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DepositModule } from './deposit/deposit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Torna as variáveis de ambiente acessíveis globalmente
    }),
    // 🚨 CORREÇÃO: Adicione todos os módulos da aplicação aqui
    PrismaModule, 
    AuthModule,
    DepositModule,
    // Adicione seus outros módulos aqui (ex: KeyclubModule, etc.)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
