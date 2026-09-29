ALTER TABLE "Review" ADD COLUMN "publicToken" TEXT NOT NULL DEFAULT '';

UPDATE "Review"
SET "publicToken" = lower(hex(randomblob(16)))
WHERE "publicToken" = '';

CREATE UNIQUE INDEX "Review_publicToken_key" ON "Review"("publicToken");

CREATE TABLE "ReviewVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "voterKey" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewVote_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReviewVote_shop_reviewId_voterKey_key"
ON "ReviewVote"("shop", "reviewId", "voterKey");

CREATE INDEX "ReviewVote_shop_reviewId_idx"
ON "ReviewVote"("shop", "reviewId");
