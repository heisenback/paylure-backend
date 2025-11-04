// src/app.module.ts (Backend)

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';

// 🚨 CORREÇÃO: Ajustando para o nome singular correto
import { DepositModule } from './deposit/deposit.module'; 
import { TransactionsModule } from './transactions/transactions.module'; 
import { ProductModule } from './product/product.module'; 
import { MarketplaceModule } from './marketplace/marketplace.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { SalesModule } from './sales/sales.module';
import { ReportModule } from './report/report.module';
import { MembershipModule } from './membership/membership.module';

@Module({
  imports: [
    PrismaModule,  
    AuthModule,    
    // 🚨 LISTA DE IMPORTS CORRIGIDA (AGORA NO SINGULAR)
    DepositModule, 
    TransactionsModule,
    ProductModule,
    MarketplaceModule,
    AffiliateModule,
    SalesModule,
    ReportModule,
    MembershipModule,
    // ... (e outros módulos da sua aplicação)
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}