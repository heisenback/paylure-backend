/*
  Warnings:

  - Made the column `apiKey` on table `User` required. This step will fail if there are existing NULL values in that column.
  - Made the column `apiSecret` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "User" ALTER COLUMN "apiKey" SET NOT NULL,
ALTER COLUMN "apiSecret" SET NOT NULL;
