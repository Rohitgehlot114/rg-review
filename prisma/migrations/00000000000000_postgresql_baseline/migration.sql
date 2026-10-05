CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewVote" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "voterKey" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RewardSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL DEFAULT 'published',
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "expirationDays" INTEGER,
    "minimumPurchase" DECIMAL(65,30),
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "onePerCustomer" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RewardSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewReward" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "requestId" TEXT,
    "productId" TEXT,
    "productTitle" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DECIMAL(65,30) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "minimumPurchase" DECIMAL(65,30),
    "status" TEXT NOT NULL,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Review_publicToken_key" ON "Review"("publicToken");
CREATE INDEX "Review_shop_idx" ON "Review"("shop");
CREATE INDEX "Review_shop_status_idx" ON "Review"("shop", "status");
CREATE INDEX "Review_shop_productId_idx" ON "Review"("shop", "productId");
CREATE INDEX "Review_shop_createdAt_idx" ON "Review"("shop", "createdAt");
CREATE INDEX "Review_shop_verifiedPurchase_idx" ON "Review"("shop", "verifiedPurchase");
CREATE INDEX "Review_shop_status_createdAt_idx" ON "Review"("shop", "status", "createdAt");
CREATE INDEX "Review_shop_rating_createdAt_idx" ON "Review"("shop", "rating", "createdAt");
CREATE INDEX "ReviewVote_shop_reviewId_idx" ON "ReviewVote"("shop", "reviewId");
CREATE UNIQUE INDEX "ReviewVote_shop_reviewId_voterKey_key" ON "ReviewVote"("shop", "reviewId", "voterKey");
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");
CREATE INDEX "ReviewRequest_shop_idx" ON "ReviewRequest"("shop");
CREATE INDEX "ReviewRequest_shop_status_idx" ON "ReviewRequest"("shop", "status");
CREATE INDEX "ReviewRequest_shop_customerEmail_idx" ON "ReviewRequest"("shop", "customerEmail");
CREATE INDEX "ReviewRequest_shop_productId_idx" ON "ReviewRequest"("shop", "productId");
CREATE INDEX "ReviewRequest_shop_createdAt_idx" ON "ReviewRequest"("shop", "createdAt");
CREATE INDEX "ReviewRequest_shop_status_createdAt_idx" ON "ReviewRequest"("shop", "status", "createdAt");
CREATE INDEX "ReviewRequest_shop_status_expiresAt_idx" ON "ReviewRequest"("shop", "status", "expiresAt");
CREATE INDEX "ReviewRequest_shop_productId_createdAt_idx" ON "ReviewRequest"("shop", "productId", "createdAt");
CREATE UNIQUE INDEX "RewardSettings_shop_key" ON "RewardSettings"("shop");
CREATE UNIQUE INDEX "ReviewReward_reviewId_key" ON "ReviewReward"("reviewId");
CREATE INDEX "ReviewReward_shop_idx" ON "ReviewReward"("shop");
CREATE INDEX "ReviewReward_shop_status_idx" ON "ReviewReward"("shop", "status");
CREATE INDEX "ReviewReward_shop_customerEmail_idx" ON "ReviewReward"("shop", "customerEmail");
CREATE INDEX "ReviewReward_shop_productId_idx" ON "ReviewReward"("shop", "productId");
CREATE UNIQUE INDEX "ReviewReward_shop_discountCode_key" ON "ReviewReward"("shop", "discountCode");

ALTER TABLE "ReviewVote"
ADD CONSTRAINT "ReviewVote_reviewId_fkey"
FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewReward"
ADD CONSTRAINT "ReviewReward_reviewId_fkey"
FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
