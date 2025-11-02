// src/deposit/deposit.module.ts
import { Module } from '@nestjs/common';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { PrismaModule } from 'src/prisma/prisma.module'; // 1. Importar o PrismaModule
import { KeyclubModule } from 'src/keyclub/keyclub.module'; // 2. Importar o KeyclubModule

@Module({
  imports: [
    PrismaModule, // 3. Adicionar aqui
    KeyclubModule, // 4. Adicionar aqui
  ],
  controllers: [DepositController],
  providers: [DepositService], // 5. O PrismaService não é mais necessário aqui
})
export class DepositModule {}