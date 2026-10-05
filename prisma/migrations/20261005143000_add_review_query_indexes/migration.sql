-- Indexes used by the admin review lists, dashboard, analytics, and expiry cleanup.
CREATE INDEX "Review_shop_status_createdAt_idx"
ON "Review"("shop", "status", "createdAt");

CREATE INDEX "Review_shop_rating_createdAt_idx"
ON "Review"("shop", "rating", "createdAt");

CREATE INDEX "ReviewRequest_shop_status_createdAt_idx"
ON "ReviewRequest"("shop", "status", "createdAt");

CREATE INDEX "ReviewRequest_shop_status_expiresAt_idx"
ON "ReviewRequest"("shop", "status", "expiresAt");

CREATE INDEX "ReviewRequest_shop_productId_createdAt_idx"
ON "ReviewRequest"("shop", "productId", "createdAt");
