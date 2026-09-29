-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "status" TEXT NOT NULL,
    "sentAt" DATETIME,
    "completedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");

-- CreateIndex
CREATE INDEX "ReviewRequest_shop_idx" ON "ReviewRequest"("shop");

-- CreateIndex
CREATE INDEX "ReviewRequest_shop_status_idx" ON "ReviewRequest"("shop", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_shop_customerEmail_idx" ON "ReviewRequest"("shop", "customerEmail");

-- CreateIndex
CREATE INDEX "ReviewRequest_shop_productId_idx" ON "ReviewRequest"("shop", "productId");

-- CreateIndex
CREATE INDEX "ReviewRequest_shop_createdAt_idx" ON "ReviewRequest"("shop", "createdAt");
