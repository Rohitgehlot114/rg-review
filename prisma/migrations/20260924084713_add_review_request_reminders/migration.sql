-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReviewRequest" (
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
    "lastReminderAt" DATETIME,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ReviewRequest" ("completedAt", "createdAt", "customerEmail", "customerName", "expiresAt", "id", "productId", "productTitle", "sentAt", "shop", "status", "token", "updatedAt") SELECT "completedAt", "createdAt", "customerEmail", "customerName", "expiresAt", "id", "productId", "productTitle", "sentAt", "shop", "status", "token", "updatedAt" FROM "ReviewRequest";
DROP TABLE "ReviewRequest";
ALTER TABLE "new_ReviewRequest" RENAME TO "ReviewRequest";
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");
CREATE INDEX "ReviewRequest_shop_idx" ON "ReviewRequest"("shop");
CREATE INDEX "ReviewRequest_shop_status_idx" ON "ReviewRequest"("shop", "status");
CREATE INDEX "ReviewRequest_shop_customerEmail_idx" ON "ReviewRequest"("shop", "customerEmail");
CREATE INDEX "ReviewRequest_shop_productId_idx" ON "ReviewRequest"("shop", "productId");
CREATE INDEX "ReviewRequest_shop_createdAt_idx" ON "ReviewRequest"("shop", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
