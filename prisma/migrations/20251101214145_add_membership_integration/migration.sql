/*
  Warnings:

  - You are about to drop the column `amount` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `gatewayTransactionId` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `pixCode` on the `Deposit` table. All the data in the column will be lost.
  - You are about to drop the column `checkoutToken` on the `PaymentLink` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Product` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[externalId]` on the table `Deposit` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `PaymentLink` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `amountInCents` to the `Deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `externalId` to the `Deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `netAmountInCents` to the `Deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `PaymentLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `slug` to the `PaymentLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."PaymentLink_checkoutToken_key";

-- AlterTable
ALTER TABLE "Deposit" DROP COLUMN "amount",
DROP COLUMN "gatewayTransactionId",
DROP COLUMN "pixCode",
ADD COLUMN     "amountInCents" INTEGER NOT NULL,
ADD COLUMN     "externalId" TEXT NOT NULL,
ADD COLUMN     "feeInCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "netAmountInCents" INTEGER NOT NULL,
ADD COLUMN     "sellerFeeInCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaymentLink" DROP COLUMN "checkoutToken",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "sellerFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "title",
ADD COLUMN     "isAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "name" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "MarketplaceProduct" (
    "id" TEXT NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "attributionType" TEXT NOT NULL DEFAULT 'LAST_CLICK',
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "promoterId" TEXT NOT NULL,
    "marketplaceProductId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProduct_productId_key" ON "MarketplaceProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_promoterId_marketplaceProductId_key" ON "Affiliate"("promoterId", "marketplaceProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_externalId_key" ON "Deposit"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_slug_key" ON "PaymentLink"("slug");

-- AddForeignKey
ALTER TABLE "MarketplaceProduct" ADD CONSTRAINT "MarketplaceProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_marketplaceProductId_fkey" FOREIGN KEY ("marketplaceProductId") REFERENCES "MarketplaceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
