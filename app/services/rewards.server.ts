import { Prisma } from "@prisma/client";

import prisma from "../db.server";
import { buildReviewRewardEmail } from "../emails/review-reward.server";
import { deliverRewardEmail } from "./email.server";
import { recordVerifiedPurchase } from "./purchase-verification.server";
import {
  createBasicDiscountCode,
  findDiscountIdByCode,
  generateRewardCode,
  loadDiscountUsage,
  loadShopCurrencyCode,
  type DiscountDraft,
} from "./shopify-discount.server";
import { rewardBlockReason } from "../utils/reward-eligibility";
import { formatDiscount, formatExpiration } from "../utils/rewards";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const PUBLISHED = "Review marked as published";

type RewardRow = {
  id: string;
  shop: string;
  reviewId: string;
  customerName: string | null;
  customerEmail: string;
  productTitle: string | null;
  discountType: string;
  discountValue: Prisma.Decimal;
  currencyCode: string;
  discountCode: string;
  shopifyDiscountId: string | null;
  status: string;
  emailStatus: string;
  expiresAt: Date | null;
  usageLimit: number;
  minimumPurchase: Prisma.Decimal | null;
};

function logReward(event: string, shop: string, reviewId: string) {
  const line = `[rg-review] ${event} shop=${shop} review=${reviewId}`;
  if (event.includes("failure") || event.includes("failed")) console.error(line);
  else console.info(line);
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function decimalNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value.toString());
}

function storeUrl(shop: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return null;
  return `https://${shop}`;
}

function discountTitle(productTitle: string | null): string {
  const product = productTitle?.trim() || "a product";
  return `RG Review reward for ${product}`.slice(0, 255);
}

async function loadSettings(shop: string) {
  return prisma.rewardSettings.findUnique({ where: { shop } });
}

async function attachRequestId(
  shop: string,
  productId: string | null,
  customerEmail: string,
): Promise<string | null> {
  if (!productId) return null;
  const request = await prisma.reviewRequest.findFirst({
    where: {
      shop,
      productId,
      customerEmail,
      status: "completed",
    },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  });
  return request?.id ?? null;
}

async function customerAlreadyRewarded(
  db: Prisma.TransactionClient | typeof prisma,
  shop: string,
  email: string,
  reviewId: string,
): Promise<boolean> {
  const rewards = await db.reviewReward.findMany({
    where: {
      shop,
      reviewId: { not: reviewId },
      OR: [{ shopifyDiscountId: { not: null } }, { status: "creating" }],
    },
    select: { customerEmail: true },
  });
  const normalized = email.trim().toLowerCase();
  return rewards.some(
    (reward) => reward.customerEmail.trim().toLowerCase() === normalized,
  );
}

function emailContent(reward: {
  customerName: string | null;
  productTitle: string | null;
  discountType: string;
  discountValue: Prisma.Decimal | number;
  currencyCode: string;
  discountCode: string;
  expiresAt: Date | null;
  usageLimit: number;
  minimumPurchase: Prisma.Decimal | number | null;
  shop: string;
}) {
  const value = decimalNumber(reward.discountValue);
  const minimum = decimalNumber(reward.minimumPurchase);
  return buildReviewRewardEmail({
    customerName: reward.customerName,
    productTitle: reward.productTitle,
    discountLabel: formatDiscount(
      reward.discountType,
      reward.discountType === "percentage"
        ? String(value)
        : value.toFixed(2),
      reward.currencyCode,
    ),
    discountCode: reward.discountCode,
    expiresLabel: formatExpiration(reward.expiresAt?.toISOString() ?? null),
    minimumLabel:
      minimum > 0
        ? formatDiscount("fixed", minimum.toFixed(2), reward.currencyCode)
        : null,
    usageLimit: reward.usageLimit,
    storeUrl: storeUrl(reward.shop),
  });
}

async function sendRewardEmail(
  reward: RewardRow,
  logEvent: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = emailContent(reward);
  const result = await deliverRewardEmail({
    to: reward.customerEmail,
    shop: reward.shop,
    reviewId: reward.reviewId,
    subject: message.subject,
    html: message.html,
    text: message.text,
    logEvent,
  });

  await prisma.reviewReward.updateMany({
    where: { id: reward.id, shop: reward.shop },
    data: { emailStatus: result.ok ? "sent" : "failed" },
  });

  return result;
}

async function finishCreatedDiscount(input: {
  admin: AdminGraphql;
  reward: RewardRow;
  draft: DiscountDraft;
}): Promise<{ ok: true; emailSent: boolean } | { ok: false }> {
  const created = await createBasicDiscountCode(input.admin, input.draft);
  if (!created.ok) {
    logReward("shopify discount creation failure", input.reward.shop, input.reward.reviewId);
    if (!created.uncertain) {
      await prisma.reviewReward.deleteMany({
        where: {
          id: input.reward.id,
          shop: input.reward.shop,
          shopifyDiscountId: null,
        },
      });
    }
    return { ok: false };
  }

  const saved = await prisma.reviewReward.updateMany({
    where: { id: input.reward.id, shop: input.reward.shop },
    data: {
      shopifyDiscountId: created.shopifyDiscountId,
      status: "active",
    },
  });

  if (saved.count !== 1) return { ok: false };

  logReward("reward created", input.reward.shop, input.reward.reviewId);
  const emailed = await sendRewardEmail(
    { ...input.reward, shopifyDiscountId: created.shopifyDiscountId, status: "active" },
    "reward email sent",
  );
  return { ok: true, emailSent: emailed.ok };
}

async function recoverCreatingReward(input: {
  admin: AdminGraphql;
  reward: RewardRow;
  draft: DiscountDraft;
}): Promise<{ ok: true; emailSent: boolean; alreadyIssued: boolean } | { ok: false }> {
  try {
    const existingId = await findDiscountIdByCode(input.admin, input.reward.discountCode);
    if (existingId) {
      await prisma.reviewReward.updateMany({
        where: { id: input.reward.id, shop: input.reward.shop },
        data: { shopifyDiscountId: existingId, status: "active" },
      });
      logReward("duplicate reward prevented", input.reward.shop, input.reward.reviewId);
      if (input.reward.emailStatus === "sent") {
        return { ok: true, emailSent: true, alreadyIssued: true };
      }
      const emailed = await sendRewardEmail(
        { ...input.reward, shopifyDiscountId: existingId, status: "active" },
        "reward email sent",
      );
      return { ok: true, emailSent: emailed.ok, alreadyIssued: true };
    }
  } catch {
    logReward("shopify discount creation failure", input.reward.shop, input.reward.reviewId);
    return { ok: false };
  }

  const finished = await finishCreatedDiscount(input);
  if (!finished.ok) return { ok: false };
  return { ok: true, emailSent: finished.emailSent, alreadyIssued: false };
}

export async function issueRewardForPublishedReview(input: {
  admin: AdminGraphql;
  shop: string;
  reviewId: string;
}): Promise<{ message: string }> {
  const review = await prisma.review.findFirst({
    where: { id: input.reviewId, shop: input.shop, status: "published" },
  });

  if (!review) return { message: PUBLISHED };

  const settings = await loadSettings(input.shop);
  const existing = await prisma.reviewReward.findFirst({
    where: { reviewId: review.id, shop: input.shop },
  });
  const email = review.customerEmail?.trim() ?? "";
  const discountValue = settings ? decimalNumber(settings.discountValue) : 0;
  const preliminary = rewardBlockReason({
    enabled: Boolean(settings?.enabled),
    status: review.status,
    hasEmail: Boolean(email),
    alreadyIssued: Boolean(existing?.shopifyDiscountId),
    discountType: settings?.discountType ?? "percentage",
    discountValue,
    usageLimit: settings?.usageLimit ?? 0,
    trigger: settings?.trigger ?? "published",
    verifiedPurchase: true,
    onePerCustomer: false,
    customerAlreadyRewarded: false,
  });

  if (preliminary === "disabled" || preliminary === "not_published") {
    return { message: PUBLISHED };
  }
  if (preliminary === "already_issued") {
    logReward("duplicate reward prevented", input.shop, review.id);
    return {
      message: `${PUBLISHED}. A reward was already issued for this review.`,
    };
  }
  if (preliminary === "missing_email") {
    return {
      message: `${PUBLISHED}. No reward was issued because this review has no customer email.`,
    };
  }
  if (preliminary === "invalid_settings" || !settings) {
    return {
      message: `${PUBLISHED}. Rewards are enabled, but the discount settings are not valid.`,
    };
  }

  let verified = review.verifiedPurchase;
  if (settings.trigger === "published_verified" && !verified) {
    verified = await recordVerifiedPurchase({
      admin: input.admin,
      shop: input.shop,
      reviewId: review.id,
      customerEmail: review.customerEmail,
      productId: review.productId,
    });
  }

  const customerRewarded = settings.onePerCustomer
    ? await customerAlreadyRewarded(prisma, input.shop, email, review.id)
    : false;
  const blocked = rewardBlockReason({
    enabled: true,
    status: review.status,
    hasEmail: true,
    alreadyIssued: false,
    discountType: settings.discountType,
    discountValue,
    usageLimit: settings.usageLimit,
    trigger: settings.trigger,
    verifiedPurchase: verified,
    onePerCustomer: settings.onePerCustomer,
    customerAlreadyRewarded: customerRewarded,
  });

  if (blocked === "not_verified") {
    return {
      message: `${PUBLISHED}. No reward was issued because a verified purchase was not found.`,
    };
  }
  if (blocked === "one_per_customer") {
    return {
      message: `${PUBLISHED}. No reward was issued because this customer already received a reward.`,
    };
  }
  if (blocked) return { message: PUBLISHED };

  const currencyCode = await loadShopCurrencyCode(input.admin);
  if (!currencyCode) {
    logReward("shopify discount creation failure", input.shop, review.id);
    return {
      message: `${PUBLISHED}. The Shopify discount could not be created, so no reward was issued.`,
    };
  }

  const startsAt = new Date();
  const expiresAt =
    settings.expirationDays === null
      ? null
      : new Date(startsAt.getTime() + settings.expirationDays * 24 * 60 * 60 * 1000);

  const usageLimit = settings.usageLimit;
  const minimumPurchase = settings.minimumPurchase;

  if (existing && !existing.shopifyDiscountId) {
    const recovered = await recoverCreatingReward({
      admin: input.admin,
      reward: existing,
      draft: {
        title: discountTitle(existing.productTitle),
        code: existing.discountCode,
        startsAt: existing.issuedAt.toISOString(),
        endsAt: existing.expiresAt?.toISOString() ?? null,
        discountType:
          existing.discountType === "fixed" ? "fixed" : "percentage",
        discountValue: decimalNumber(existing.discountValue),
        minimumPurchase:
          existing.minimumPurchase === null
            ? null
            : decimalNumber(existing.minimumPurchase),
        usageLimit: existing.usageLimit,
        onePerCustomer: settings.onePerCustomer,
      },
    });

    if (!recovered.ok) {
      return {
        message: `${PUBLISHED}. The Shopify discount could not be created, so no reward was issued.`,
      };
    }
    if (recovered.alreadyIssued && recovered.emailSent) {
      return {
        message: `${PUBLISHED}. A reward was already issued for this review.`,
      };
    }
    if (!recovered.emailSent) {
      return {
        message: `${PUBLISHED}. The discount was created, but the reward email could not be sent. You can resend it from Rewards.`,
      };
    }
    return {
      message: `${PUBLISHED}. A reward discount was created and emailed.`,
    };
  }

  const requestId = await attachRequestId(input.shop, review.productId, email);
  let claim: { id: string; discountCode: string } | null = null;

  for (let attempt = 0; attempt < 3 && !claim; attempt += 1) {
    const discountCode = generateRewardCode();
    try {
      claim = await prisma.$transaction(async (tx) => {
        if (
          settings.onePerCustomer &&
          (await customerAlreadyRewarded(tx, input.shop, email, review.id))
        ) {
          throw new Error("one-reward-per-customer");
        }

        return tx.reviewReward.create({
          data: {
            shop: input.shop,
            reviewId: review.id,
            requestId,
            productId: review.productId,
            productTitle: review.productTitle,
            customerName: review.customerName,
            customerEmail: email,
            discountType: settings.discountType,
            discountValue: new Prisma.Decimal(discountValue),
            currencyCode,
            discountCode,
            usageLimit,
            minimumPurchase,
            status: "creating",
            emailStatus: "pending",
            expiresAt,
            issuedAt: startsAt,
          },
          select: { id: true, discountCode: true },
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "one-reward-per-customer") {
        return {
          message: `${PUBLISHED}. No reward was issued because this customer already received a reward.`,
        };
      }
      if (!isUniqueConflict(error)) throw error;
      const raced = await prisma.reviewReward.findFirst({
        where: { reviewId: review.id, shop: input.shop },
        select: { id: true },
      });
      if (raced) {
        logReward("duplicate reward prevented", input.shop, review.id);
        return {
          message: `${PUBLISHED}. A reward was already issued for this review.`,
        };
      }
    }
  }

  if (!claim) {
    logReward("shopify discount creation failure", input.shop, review.id);
    return {
      message: `${PUBLISHED}. The Shopify discount could not be created, so no reward was issued.`,
    };
  }

  const finished = await finishCreatedDiscount({
    admin: input.admin,
    reward: {
      id: claim.id,
      shop: input.shop,
      reviewId: review.id,
      customerName: review.customerName,
      customerEmail: email,
      productTitle: review.productTitle,
      discountType: settings.discountType,
      discountValue: new Prisma.Decimal(discountValue),
      currencyCode,
      discountCode: claim.discountCode,
      shopifyDiscountId: null,
      status: "creating",
      emailStatus: "pending",
      expiresAt,
      usageLimit,
      minimumPurchase,
    },
    draft: {
      title: discountTitle(review.productTitle),
      code: claim.discountCode,
      startsAt: startsAt.toISOString(),
      endsAt: expiresAt?.toISOString() ?? null,
      discountType: settings.discountType === "fixed" ? "fixed" : "percentage",
      discountValue,
      minimumPurchase:
        minimumPurchase === null ? null : decimalNumber(minimumPurchase),
      usageLimit,
      onePerCustomer: settings.onePerCustomer,
    },
  });

  if (!finished.ok) {
    return {
      message: `${PUBLISHED}. The Shopify discount could not be created, so no reward was issued.`,
    };
  }

  if (!finished.emailSent) {
    return {
      message: `${PUBLISHED}. The discount was created, but the reward email could not be sent. You can resend it from Rewards.`,
    };
  }

  return {
    message: `${PUBLISHED}. A reward discount was created and emailed.`,
  };
}

export async function resendRewardEmail(input: {
  shop: string;
  rewardId: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const reward = await prisma.reviewReward.findFirst({
    where: { id: input.rewardId, shop: input.shop },
  });

  if (!reward?.shopifyDiscountId) {
    return { ok: false, error: "This reward does not have a coupon to resend." };
  }

  const emailed = await sendRewardEmail(reward, "reward email resent");

  if (!emailed.ok) return emailed;
  return { ok: true, message: "Reward email resent." };
}

type ListedReward = {
  id: string;
  shopifyDiscountId: string | null;
  status: string;
  emailStatus: string;
  expiresAt: Date | null;
  redeemedAt: Date | null;
};

export async function refreshListedRewardStatuses(
  admin: AdminGraphql,
  shop: string,
  rewards: ListedReward[],
): Promise<void> {
  const ids = rewards.flatMap((reward) =>
    reward.shopifyDiscountId ? [reward.shopifyDiscountId] : [],
  );
  const usage = await loadDiscountUsage(admin, ids);
  if (!usage) {
    console.error(`[rg-review] reward status refresh failed shop=${shop}`);
    return;
  }

  const byId = new Map(usage.map((entry) => [entry.shopifyDiscountId, entry]));
  const now = new Date();

  for (const reward of rewards) {
    if (!reward.shopifyDiscountId) continue;
    const remote = byId.get(reward.shopifyDiscountId);
    if (!remote) continue;

    let status = reward.status === "creating" ? "active" : reward.status;
    let redeemedAt = reward.redeemedAt;
    let expiresAt = reward.expiresAt;

    if (!remote.present) {
      status = "cancelled";
    } else if (remote.usageCount !== null && remote.usageCount > 0) {
      status = "redeemed";
      redeemedAt = redeemedAt ?? now;
    } else if (
      remote.status === "EXPIRED" ||
      (remote.endsAt !== null && new Date(remote.endsAt).getTime() <= now.getTime())
    ) {
      status = "expired";
    } else if (remote.status === "ACTIVE" || remote.status === "SCHEDULED") {
      status = "active";
    }

    if (remote?.endsAt) {
      const parsed = new Date(remote.endsAt);
      if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
    }

    reward.status = status;
    reward.expiresAt = expiresAt;
    reward.redeemedAt = redeemedAt;

    await prisma.reviewReward.updateMany({
      where: { id: reward.id, shop },
      data: { status, expiresAt, redeemedAt },
    });
  }
}

export async function countPendingRewards(shop: string): Promise<number> {
  const settings = await loadSettings(shop);
  if (!settings?.enabled) return 0;

  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT COUNT(*) as count
    FROM Review r
    WHERE r.shop = ${shop}
      AND r.status = 'published'
      AND r.customerEmail IS NOT NULL
      AND TRIM(r.customerEmail) != ''
      AND (${settings.trigger === "published_verified" ? 1 : 0} = 0 OR r.verifiedPurchase = 1)
      AND NOT EXISTS (
        SELECT 1 FROM ReviewReward rw
        WHERE rw.reviewId = r.id
          AND rw.shop = r.shop
          AND rw.shopifyDiscountId IS NOT NULL
      )
      AND (
        ${settings.onePerCustomer ? 1 : 0} = 0
        OR NOT EXISTS (
          SELECT 1 FROM ReviewReward rw2
          WHERE rw2.shop = r.shop
            AND rw2.shopifyDiscountId IS NOT NULL
            AND lower(rw2.customerEmail) = lower(r.customerEmail)
            AND rw2.reviewId != r.id
        )
      )
  `;

  return Number(rows[0]?.count ?? 0);
}
