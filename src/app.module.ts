cat > ~/paylure-backend/src/app.module.ts << 'EOF'
// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';

// Core modules
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

// Payment modules
import { DepositModule } from './deposit/deposit.module';
import { WithdrawalModule } from './withdrawal/withdrawal.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WebhooksModule } from './webhooks/webhooks.module';

// Integration modules
import { KeyclubModule } from './keyclub/keyclub.module';

// Business modules
import { ProductModule } from './product/product.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { SalesModule } from './sales/sales.module';
import { MembershipModule } from './membership/membership.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { MerchantModule } from './merchant/merchant.module';
import { PaymentLinkModule } from './payment-link/payment-link.module';
import { ReportModule } from './report/report.module';

// Public API Module (para clientes externos)
import { PublicApiModule } from './api/public-api.module';

@Module({
  imports: [
    // Config (global)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Core (sempre primeiro)
    PrismaModule,
    AuthModule,

    // Payment Processing
    DepositModule,
    WithdrawalModule,
    TransactionsModule,
    WebhooksModule,

    // External Integrations
    KeyclubModule,

    // Business Logic
    ProductModule,
    MarketplaceModule,
    AffiliateModule,
    SalesModule,
    MembershipModule,
    SubscriptionModule,
    MerchantModule,
    PaymentLinkModule,
    ReportModule,

    // Public API (Client ID/Secret Authentication)
    PublicApiModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
EOF