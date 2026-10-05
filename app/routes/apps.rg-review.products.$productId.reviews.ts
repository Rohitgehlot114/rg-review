import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { privacyDisplayName } from "../utils/published-reviews.server";
import { REVIEW_SUBMISSION_LIMITS } from "../utils/review-submission.server";

type Distribution = Record<"1" | "2" | "3" | "4" | "5", number>;

function emptyDistribution(): Distribution {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
}

function jsonData(data: unknown, status = 200, cache = "private, max-age=30") {
  return Response.json(
    { success: true, data },
    { status, headers: { "Cache-Control": cache } },
  );
}

function jsonError(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function shopFromProxy(request: Request) {
  try {
    const context = await authenticate.public.appProxy(request);
    return context.session?.shop ?? null;
  } catch (error) {
    if (error instanceof Response) return null;
    return null;
  }
}

function productIds(productId: string) {
  return [`gid://shopify/Product/${productId}`, productId];
}

function listQuery(url: URL) {
  const sortParam = url.searchParams.get("sort");
  const sort =
    sortParam === "highest" || sortParam === "lowest" || sortParam === "newest"
      ? sortParam
      : "newest";
  const ratingParam = url.searchParams.get("rating");
  const rating = ratingParam ? Number.parseInt(ratingParam, 10) : null;
  if (ratingParam && (!Number.isInteger(rating) || rating! < 1 || rating! > 5)) {
    return null;
  }
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(20, Math.max(1, requestedLimit))
    : 10;
  return { sort, rating, limit };
}

function cursorOffset(value: string | null): number | null {
  if (!value) return 0;
  try {
    const parsed = Number.parseInt(
      Buffer.from(value, "base64url").toString("utf8"),
      10,
    );
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const productId = params.productId?.trim() ?? "";
  if (!/^\d{1,20}$/.test(productId)) {
    return jsonError("MISSING_PRODUCT", "Product is required", 400);
  }

  const shop = await shopFromProxy(request);
  if (!shop) return jsonError("INVALID_SIGNATURE", "Request signature is invalid", 401);

  const query = listQuery(new URL(request.url));
  if (!query) return jsonError("INVALID_REVIEW", "The review list filters are invalid", 400);
  const offset = cursorOffset(new URL(request.url).searchParams.get("cursor"));
  if (offset === null) return jsonError("INVALID_CURSOR", "Cursor is invalid", 400);

  const where: Prisma.ReviewWhereInput = {
    shop,
    productId: { in: productIds(productId) },
    status: "published",
    ...(query.rating ? { rating: query.rating } : {}),
  };
  const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
    query.sort === "highest"
      ? [{ rating: "desc" }, { createdAt: "desc" }]
      : query.sort === "lowest"
        ? [{ rating: "asc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }];

  const [rows, groups] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip: offset,
      take: query.limit + 1,
      select: {
        rating: true,
        title: true,
        body: true,
        customerName: true,
        verifiedPurchase: true,
        createdAt: true,
      },
    }),
    prisma.review.groupBy({
      by: ["rating"],
      where: {
        shop,
        productId: { in: productIds(productId) },
        status: "published",
      },
      _count: { _all: true },
    }),
  ]);

  const hasMore = rows.length > query.limit;
  const reviews = (hasMore ? rows.slice(0, query.limit) : rows).map((review) => ({
    rating: review.rating,
    title: review.title,
    body: review.body,
    displayName: privacyDisplayName(review.customerName),
    verifiedPurchase: review.verifiedPurchase,
    submittedAt: review.createdAt.toISOString(),
  }));
  const distribution = emptyDistribution();
  let totalReviews = 0;
  let ratingTotal = 0;
  for (const group of groups) {
    const key = String(group.rating) as keyof Distribution;
    if (distribution[key] === undefined) continue;
    distribution[key] = group._count._all;
    totalReviews += group._count._all;
    ratingTotal += group.rating * group._count._all;
  }

  return jsonData({
    reviews,
    nextCursor: hasMore
      ? Buffer.from(String(offset + reviews.length), "utf8").toString("base64url")
      : null,
    averageRating: totalReviews ? Math.round((ratingTotal / totalReviews) * 10) / 10 : null,
    totalReviews,
    distribution,
    showWriteReviewButton: true,
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
  }

  const productId = params.productId?.trim() ?? "";
  if (!/^\d{1,20}$/.test(productId)) {
    return jsonError("MISSING_PRODUCT", "Product is required", 400);
  }
  const shop = await shopFromProxy(request);
  if (!shop) return jsonError("INVALID_SIGNATURE", "Request signature is invalid", 401);

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError("INVALID_REVIEW", "Enter a rating and a review", 400);
  if (String(form.get("website") ?? "").trim()) {
    return jsonData({ status: "PENDING" }, 200, "no-store");
  }

  const rating = Number.parseInt(String(form.get("rating") ?? ""), 10);
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const displayName = String(form.get("displayName") ?? "").trim();
  const productTitle = String(form.get("productTitle") ?? "").trim();
  if (
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    body.length < REVIEW_SUBMISSION_LIMITS.bodyMin ||
    body.length > REVIEW_SUBMISSION_LIMITS.bodyMax ||
    title.length > REVIEW_SUBMISSION_LIMITS.titleMax ||
    !displayName ||
    displayName.length > REVIEW_SUBMISSION_LIMITS.nameMax
  ) {
    return jsonError("INVALID_REVIEW", "Enter a rating and a review", 400);
  }

  const duplicate = await prisma.review.findFirst({
    where: {
      shop,
      productId: { in: productIds(productId) },
      body,
      customerName: displayName,
      createdAt: {
        gte: new Date(Date.now() - REVIEW_SUBMISSION_LIMITS.duplicateWindowMs),
      },
    },
    select: { id: true },
  });
  if (duplicate) return jsonError("DUPLICATE_REVIEW", "This review was already submitted", 409);

  await prisma.review.create({
    data: {
      shop,
      productId: `gid://shopify/Product/${productId}`,
      productTitle: productTitle || null,
      customerName: displayName,
      rating,
      title: title || null,
      body,
      status: "published",
    },
  });

  return jsonData({ status: "PUBLISHED" }, 200, "no-store");
};
