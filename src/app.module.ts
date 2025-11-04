// src/app.module.ts (Backend)

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';

// 🚨 ADICIONE ESTAS IMPORTAÇÕES (BASEADO NAS ROTAS FALTANTES)
import { DepositsModule } from './deposit/deposit.module'; 
import { TransactionsModule } from './transactions/transactions.module'; 
import { ProductsModule } from './product/product.module'; 
import { MarketplaceModule } from './marketplace/marketplace.module';
import { AffiliatesModule } from './affiliate/affiliate.module';
import { SalesModule } from './sales/sales.module';
import { ReportsModule } from './report/report.module';
import { MembershipModule } from './membership/membership.module'; // Exemplo para /membership/integrations

@Module({
  imports: [
    PrismaModule,  
    AuthModule,    
    // 🚨 LISTA COMPLETA DOS MÓDULOS DE NEGÓCIO
    DepositsModule, 
    TransactionsModule,
    ProductsModule,
    MarketplaceModule,
    AffiliatesModule,
    SalesModule,
    ReportsModule,
    MembershipModule,
    // (Adicione qualquer outro módulo que seu projeto tenha, como WithdrawalModule)
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}