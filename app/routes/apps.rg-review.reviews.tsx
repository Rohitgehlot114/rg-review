import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHash, randomBytes } from "node:crypto";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  formatAverageForApi,
  mapPublishedReviewForStorefront,
  parsePublishedReviewsQuery,
  publishedReviewsWhere,
} from "../utils/published-reviews.server";
import { recordVerifiedPurchase } from "../services/purchase-verification.server";
import {
  REVIEW_SUBMISSION_LIMITS,
  parseReviewSubmissionFormData,
  validateReviewSubmission,
} from "../utils/review-submission.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const VOTER_COOKIE = "rg_review_voter";

function getVoter(request: Request) {
  const existing = request.headers
    .get("Cookie")
    ?.match(new RegExp(`${VOTER_COOKIE}=([a-f0-9]{48})`))?.[1];
  const value = existing ?? randomBytes(24).toString("hex");
  return {
    key: createHash("sha256").update(value).digest("hex"),
    setCookie: existing
      ? undefined
      : `${VOTER_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
  };
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

async function verifyProduct(
  admin: AdminGraphql,
  productGid: string,
): Promise<{ id: string; title: string } | null> {
  const response = await admin.graphql(
    `#graphql
      query ReviewStorefrontProduct($id: ID!) {
        product(id: $id) {
          id
          title
        }
      }`,
    { variables: { id: productGid } },
  );

  const payload = await response.json();
  const product = payload?.data?.product;
  if (!product?.id || typeof product.title !== "string") {
    return null;
  }
  return { id: product.id, title: product.title };
}

async function authenticateAppProxy(request: Request) {
  try {
    const context = await authenticate.public.appProxy(request);
    return { ok: true as const, context };
  } catch (error) {
    if (error instanceof Response) {
      return {
        ok: false as const,
        response: jsonResponse(
          {
            ok: false,
            error: "Unable to verify this request came from your Shopify store.",
          },
          error.status === 400 ? 401 : error.status || 401,
        ),
      };
    }
    return {
      ok: false as const,
      response: jsonResponse(
        {
          ok: false,
          error: "Unable to verify this request came from your Shopify store.",
        },
        401,
      ),
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAppProxy(request);
  if (!auth.ok) return auth.response;

  const { session, admin } = auth.context;

  if (!session?.shop || !admin) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Reviews are unavailable because this store is not connected to RG Review.",
      },
      401,
    );
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const parsed = parsePublishedReviewsQuery(url);

  if (parsed.error) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  const productGid = `gid://shopify/Product/${parsed.productIdRaw}`;

  let product: { id: string; title: string } | null;
  try {
    product = await verifyProduct(admin, productGid);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to verify the product for these reviews.",
      },
      502,
    );
  }

  if (!product) {
    return jsonResponse(
      {
        ok: false,
        error: "This product could not be found in your store.",
      },
      400,
    );
  }

  const where = publishedReviewsWhere(shop, productGid);
  const voter = getVoter(request);

  try {
    const [count, aggregate, reviews] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.aggregate({
        where,
        _avg: { rating: true },
      }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: parsed.offset,
        take: parsed.limit,
        select: {
          id: true,
          publicToken: true,
          customerName: true,
          rating: true,
          title: true,
          body: true,
          createdAt: true,
          productTitle: true,
          verifiedPurchase: true,
        },
      }),
    ]);

    const votes = reviews.length
      ? await prisma.reviewVote.findMany({
          where: {
            shop,
            reviewId: { in: reviews.map((review) => review.id) },
          },
          select: { reviewId: true, voterKey: true, helpful: true },
        })
      : [];
    const mapped = reviews.map((review) => {
      const reviewVotes = votes.filter((vote) => vote.reviewId === review.id);
      return mapPublishedReviewForStorefront({
        ...review,
        helpfulCount: reviewVotes.filter((vote) => vote.helpful).length,
        unhelpfulCount: reviewVotes.filter((vote) => !vote.helpful).length,
        viewerVote:
          reviewVotes.find((vote) => vote.voterKey === voter.key)?.helpful ??
          null,
      });
    });
    const nextOffset = parsed.offset + mapped.length;

    return jsonResponse(
      {
        ok: true,
        reviews: mapped,
        summary: {
          count,
          averageRating: formatAverageForApi(aggregate._avg.rating),
        },
        pagination: {
          limit: parsed.limit,
          offset: parsed.offset,
          nextOffset,
          hasMore: nextOffset < count,
        },
      },
      200,
      voter.setCookie ? { "Set-Cookie": voter.setCookie } : undefined,
    );
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to load reviews right now. Please try again later.",
      },
      500,
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  const auth = await authenticateAppProxy(request);
  if (!auth.ok) return auth.response;

  const { session, admin } = auth.context;

  if (!session?.shop || !admin) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Reviews are unavailable because this store is not connected to RG Review.",
      },
      401,
    );
  }

  // Shop is derived from the verified App Proxy session — never from client input.
  const shop = session.shop;
  if (request.headers.get("Content-Type")?.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as {
      reviewToken?: unknown;
      helpful?: unknown;
    } | null;
    const reviewToken =
      typeof payload?.reviewToken === "string"
        ? payload.reviewToken.trim()
        : "";
    if (!reviewToken || typeof payload?.helpful !== "boolean") {
      return jsonResponse(
        { ok: false, error: "A review and vote choice are required." },
        400,
      );
    }

    const voter = getVoter(request);
    const review = await prisma.review.findFirst({
      where: { shop, publicToken: reviewToken, status: "published" },
      select: { id: true },
    });
    if (!review) {
      return jsonResponse({ ok: false, error: "Review not found." }, 404);
    }

    try {
      await prisma.reviewVote.upsert({
        where: {
          shop_reviewId_voterKey: {
            shop,
            reviewId: review.id,
            voterKey: voter.key,
          },
        },
        create: {
          shop,
          reviewId: review.id,
          voterKey: voter.key,
          helpful: payload.helpful,
        },
        update: { helpful: payload.helpful },
      });
      const counts = await prisma.reviewVote.groupBy({
        by: ["helpful"],
        where: { shop, reviewId: review.id },
        _count: { _all: true },
      });
      return jsonResponse(
        {
          ok: true,
          helpfulCount:
            counts.find((row) => row.helpful)?._count._all ?? 0,
          unhelpfulCount:
            counts.find((row) => !row.helpful)?._count._all ?? 0,
          viewerVote: payload.helpful,
        },
        200,
        voter.setCookie ? { "Set-Cookie": voter.setCookie } : undefined,
      );
    } catch {
      return jsonResponse(
        { ok: false, error: "Unable to save your vote right now." },
        500,
      );
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid form submission." }, 400);
  }

  const validation = validateReviewSubmission(
    parseReviewSubmissionFormData(formData),
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "Please correct the highlighted fields and try again.",
        errors: validation.errors,
      },
      400,
    );
  }

  const submission = validation.data;

  let product: { id: string; title: string } | null;
  try {
    product = await verifyProduct(admin, submission.productGid);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to verify the product for this review. Please try again.",
      },
      502,
    );
  }

  if (!product) {
    return jsonResponse(
      {
        ok: false,
        error: "This product could not be found in your store.",
        errors: { product_id: "Invalid product." },
      },
      400,
    );
  }

  const duplicateSince = new Date(
    Date.now() - REVIEW_SUBMISSION_LIMITS.duplicateWindowMs,
  );

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.review.updateMany({
        where: {
          shop,
          productId: submission.productGid,
          customerEmail: submission.customerEmail,
          createdAt: { gte: duplicateSince },
        },
        data: { updatedAt: new Date() },
      });

      const recentDuplicate = await tx.review.findFirst({
        where: {
          shop,
          productId: submission.productGid,
          customerEmail: submission.customerEmail,
          createdAt: { gte: duplicateSince },
        },
        select: { id: true },
      });
      if (recentDuplicate) return null;

      return tx.review.create({
        data: {
          shop,
          productId: submission.productGid,
          productTitle: product.title,
          customerName: submission.customerName,
          customerEmail: submission.customerEmail,
          rating: submission.rating,
          title: submission.title,
          body: submission.body,
          status: "pending",
        },
        select: {
          id: true,
          publicToken: true,
          customerName: true,
          rating: true,
          title: true,
          body: true,
          createdAt: true,
          productTitle: true,
          verifiedPurchase: true,
        },
      });
    });

    if (!created) {
      return jsonResponse(
        {
          ok: false,
          error:
            "You already submitted a review for this product recently. Please wait a few minutes before trying again.",
        },
        429,
      );
    }

    void recordVerifiedPurchase({
      admin,
      shop,
      reviewId: created.id,
      customerEmail: submission.customerEmail,
      productId: submission.productGid,
    });

    return jsonResponse({
      ok: true,
      message:
        "Thank you for your review. Your review has been submitted and is awaiting approval.",
      review: {
        ...mapPublishedReviewForStorefront({
          ...created,
          helpfulCount: 0,
          unhelpfulCount: 0,
          viewerVote: null,
        }),
        productId: submission.productNumericId,
      },
    });
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to save your review right now. Please try again later.",
      },
      500,
    );
  }
};
