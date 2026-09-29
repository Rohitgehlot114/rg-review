-- CreateTable
CREATE TABLE "RewardSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL DEFAULT 'published',
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" DECIMAL NOT NULL DEFAULT 0,
    "expirationDays" INTEGER,
    "minimumPurchase" DECIMAL,
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "onePerCustomer" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReviewReward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "requestId" TEXT,
    "productId" TEXT,
    "productTitle" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DECIMAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "minimumPurchase" DECIMAL,
    "status" TEXT NOT NULL,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewReward_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Review" ("body", "createdAt", "customerEmail", "customerName", "id", "productId", "productTitle", "rating", "shop", "status", "title", "updatedAt") SELECT "body", "createdAt", "customerEmail", "customerName", "id", "productId", "productTitle", "rating", "shop", "status", "title", "updatedAt" FROM "Review";
DROP TABLE "Review";
ALTER TABLE "new_Review" RENAME TO "Review";
CREATE INDEX "Review_shop_idx" ON "Review"("shop");
CREATE INDEX "Review_shop_status_idx" ON "Review"("shop", "status");
CREATE INDEX "Review_shop_productId_idx" ON "Review"("shop", "productId");
CREATE INDEX "Review_shop_createdAt_idx" ON "Review"("shop", "createdAt");
CREATE INDEX "Review_shop_verifiedPurchase_idx" ON "Review"("shop", "verifiedPurchase");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RewardSettings_shop_key" ON "RewardSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReward_reviewId_key" ON "ReviewReward"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewReward_shop_idx" ON "ReviewReward"("shop");

-- CreateIndex
CREATE INDEX "ReviewReward_shop_status_idx" ON "ReviewReward"("shop", "status");

-- CreateIndex
CREATE INDEX "ReviewReward_shop_customerEmail_idx" ON "ReviewReward"("shop", "customerEmail");

-- CreateIndex
CREATE INDEX "ReviewReward_shop_productId_idx" ON "ReviewReward"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReward_shop_discountCode_key" ON "ReviewReward"("shop", "discountCode");
