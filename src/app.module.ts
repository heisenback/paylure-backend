import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DepositModule } from './deposit/deposit.module';
import { WithdrawalModule } from './withdrawal/withdrawal.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { XflowModule } from './xflow/xflow.module';
import { ProductModule } from './product/product.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { AffiliateModule } from './affiliate/affiliate.module';
import { SalesModule } from './sales/sales.module';
import { MembershipModule } from './membership/membership.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { MerchantModule } from './merchant/merchant.module';
import { PaymentLinkModule } from './payment-link/payment-link.module';
import { ReportModule } from './report/report.module';
import { PublicApiModule } from './api/public-api.module';
import { SocketModule } from './gateway/socket.module';
import { PushNotificationModule } from './push-notification/push-notification.module';
import { AdminModule } from './admin/admin.module';
import { CheckoutModule } from './checkout/checkout.module';
import { PixelsModule } from './pixels/pixels.module';
import { MemberAreaModule } from './member-area/member-area.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    DepositModule,
    WithdrawalModule,
    TransactionsModule,
    WebhooksModule,
    XflowModule,
    ProductModule,
    MarketplaceModule,
    AffiliateModule,
    SalesModule,
    MembershipModule,
    SubscriptionModule,
    MerchantModule,
    PaymentLinkModule,
    ReportModule,
    PublicApiModule,
    SocketModule,
    PushNotificationModule,
    AdminModule,
    CheckoutModule,
    PixelsModule,
    MemberAreaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}