import type { Prisma } from "@prisma/client";

export const PUBLISHED_REVIEWS_DEFAULT_LIMIT = 10;
export const PUBLISHED_REVIEWS_MAX_LIMIT = 20;

export type PublishedReviewListItem = {
  reviewToken: string;
  customerName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  productTitle: string | null;
  verifiedPurchase: boolean;
  helpfulCount: number;
  unhelpfulCount: number;
  viewerVote: boolean | null;
};

export type PublishedReviewsSummary = {
  count: number;
  averageRating: number | null;
};

export function privacyDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Customer";

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];

  const first = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

export function parsePublishedReviewsQuery(url: URL): {
  productIdRaw: string;
  limit: number;
  offset: number;
  error?: string;
} {
  const productIdRaw = (url.searchParams.get("product_id") ?? "").trim();
  if (!/^\d+$/.test(productIdRaw)) {
    return {
      productIdRaw,
      limit: PUBLISHED_REVIEWS_DEFAULT_LIMIT,
      offset: 0,
      error: "A valid product is required.",
    };
  }

  const limitParsed = Number.parseInt(
    url.searchParams.get("limit") ?? String(PUBLISHED_REVIEWS_DEFAULT_LIMIT),
    10,
  );
  const offsetParsed = Number.parseInt(
    url.searchParams.get("offset") ?? "0",
    10,
  );

  const limit = Number.isFinite(limitParsed)
    ? Math.min(
        PUBLISHED_REVIEWS_MAX_LIMIT,
        Math.max(1, limitParsed),
      )
    : PUBLISHED_REVIEWS_DEFAULT_LIMIT;

  const offset =
    Number.isFinite(offsetParsed) && offsetParsed > 0
      ? Math.min(offsetParsed, 10_000)
      : 0;

  return { productIdRaw, limit, offset };
}

export function publishedReviewsWhere(
  shop: string,
  productGid: string,
): Prisma.ReviewWhereInput {
  return {
    shop,
    productId: productGid,
    status: "published",
  };
}

export function mapPublishedReviewForStorefront(review: {
  publicToken: string;
  customerName: string | null;
  rating: number;
  title: string | null;
  body: string;
  createdAt: Date;
  productTitle: string | null;
  verifiedPurchase: boolean;
  helpfulCount?: number;
  unhelpfulCount?: number;
  viewerVote?: boolean | null;
}): PublishedReviewListItem {
  return {
    reviewToken: review.publicToken,
    customerName: privacyDisplayName(review.customerName),
    rating: review.rating,
    title: review.title,
    body: review.body,
    createdAt: review.createdAt.toISOString(),
    productTitle: review.productTitle,
    verifiedPurchase: review.verifiedPurchase === true,
    helpfulCount: review.helpfulCount ?? 0,
    unhelpfulCount: review.unhelpfulCount ?? 0,
    viewerVote: review.viewerVote ?? null,
  };
}

export function formatAverageForApi(
  average: number | null | undefined,
): number | null {
  if (average === null || average === undefined) return null;
  return Math.round(average * 10) / 10;
}
