import prisma from "../db.server";
import { REVIEW_REQUEST_EXPIRY_OPTIONS } from "./review-requests";
import { REVIEW_SUBMISSION_LIMITS } from "./review-submission.server";

export { createReviewRequestToken, isReviewRequestToken } from "./review-request-token";

const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;

export function reviewRequestPath(token: string): string {
  return `/review-request/${token}`;
}

export function reviewRequestUrl(token: string): string | null {
  const configured = process.env.SHOPIFY_APP_URL?.trim();
  if (!configured) return null;

  try {
    const origin = new URL(configured).origin;
    return `${origin}${reviewRequestPath(token)}`;
  } catch {
    return null;
  }
}

export function isProductGid(value: string): boolean {
  return PRODUCT_GID_PATTERN.test(value);
}

export function parseExpirySelection(
  value: string,
): { ok: true; days: number | null } | { ok: false } {
  if (!value) return { ok: true, days: null };
  const days = Number.parseInt(value, 10);
  if (!(REVIEW_REQUEST_EXPIRY_OPTIONS as readonly number[]).includes(days)) {
    return { ok: false };
  }
  return { ok: true, days };
}

export function expiresAtFromDays(days: number | null, now = new Date()): Date | null {
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function validateOptionalCustomerName(name: string): string | null {
  if (name.length > REVIEW_SUBMISSION_LIMITS.nameMax) {
    return `Name must be ${REVIEW_SUBMISSION_LIMITS.nameMax} characters or fewer.`;
  }
  return null;
}

export function isOpenReviewRequest(status: string): boolean {
  return status === "pending" || status === "sent";
}

export function requestIsPastExpiry(
  expiresAt: Date | null,
  now = new Date(),
): boolean {
  return Boolean(expiresAt && expiresAt.getTime() < now.getTime());
}

export async function expireOpenReviewRequests(shop: string, now = new Date()) {
  await prisma.reviewRequest.updateMany({
    where: {
      shop,
      status: { in: ["pending", "sent"] },
      expiresAt: { lt: now },
    },
    data: { status: "expired" },
  });
}
