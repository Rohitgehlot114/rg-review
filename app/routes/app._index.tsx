import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  RECENT_REVIEWS_LIMIT,
  formatAverageRating,
  formatDate,
  formatStars,
  previewText,
  statusBadgeTone,
  statusLabel,
} from "../utils/reviews";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const [totalReviews, published, pending, aggregate, recentReviews, requestPending, requestSent, requestCompleted] =
      await Promise.all([
        prisma.review.count({ where: { shop } }),
        prisma.review.count({ where: { shop, status: "published" } }),
        prisma.review.count({ where: { shop, status: "pending" } }),
        prisma.review.aggregate({
          where: { shop },
          _avg: { rating: true },
        }),
        prisma.review.findMany({
          where: { shop },
          orderBy: { createdAt: "desc" },
          take: RECENT_REVIEWS_LIMIT,
          select: {
            id: true,
            customerName: true,
            productTitle: true,
            rating: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.reviewRequest.count({ where: { shop, status: "pending" } }),
        prisma.reviewRequest.count({ where: { shop, status: "sent" } }),
        prisma.reviewRequest.count({ where: { shop, status: "completed" } }),
      ]);

    return {
      shop,
      stats: {
        totalReviews,
        published,
        pending,
        averageRating: aggregate._avg.rating,
      },
      requestStats: {
        pending: requestPending,
        sent: requestSent,
        completed: requestCompleted,
      },
      recentReviews,
    };
  } catch {
    return {
      shop,
      stats: {
        totalReviews: 0,
        published: 0,
        pending: 0,
        averageRating: null as number | null,
      },
      requestStats: {
        pending: 0,
        sent: 0,
        completed: 0,
      },
      recentReviews: [],
      loadError: "Unable to load dashboard statistics right now.",
    };
  }
};

export default function Dashboard() {
  const { shop, stats, requestStats, recentReviews, loadError } =
    useLoaderData<typeof loader>();

  if (loadError) {
    return (
      <s-page heading="RG Review">
        <s-banner tone="critical" heading="Could not load statistics">
          <s-paragraph>{loadError}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="RG Review">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Manage, collect, and showcase customer reviews.
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Store: </s-text>
            <s-text>{shop}</s-text>
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            minInlineSize="120px"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Total Reviews</s-text>
              <s-heading>{stats.totalReviews}</s-heading>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            minInlineSize="120px"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Published</s-text>
              <s-heading>{stats.published}</s-heading>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            minInlineSize="120px"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Pending</s-text>
              <s-heading>{stats.pending}</s-heading>
            </s-stack>
          </s-box>

          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
            minInlineSize="120px"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Average Rating</s-text>
              <s-heading>
                {formatAverageRating(stats.averageRating)}
              </s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Review requests">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              minInlineSize="120px"
            >
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Pending</s-text>
                <s-heading>{requestStats.pending}</s-heading>
              </s-stack>
            </s-box>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              minInlineSize="120px"
            >
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Sent</s-text>
                <s-heading>{requestStats.sent}</s-heading>
              </s-stack>
            </s-box>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
              minInlineSize="120px"
            >
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Completed</s-text>
                <s-heading>{requestStats.completed}</s-heading>
              </s-stack>
            </s-box>
          </s-stack>
          <s-button href="/app/review-requests" variant="tertiary">
            Manage review requests
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Recent reviews">
        {recentReviews.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>No reviews yet</s-heading>
              <s-paragraph>
                Reviews for this store will appear here once they are collected
                and stored in the database. There are currently no reviews to
                display.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button href="/app/reviews" variant="primary">
                  Go to Reviews
                </s-button>
                <s-button href="/app/review-requests" variant="tertiary">
                  Review Requests
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="secondary">Product</s-table-header>
                <s-table-header>Rating</s-table-header>
                <s-table-header>Review</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Date</s-table-header>
              </s-table-header-row>
              {recentReviews.map((review) => (
                <s-table-row key={review.id}>
                  <s-table-cell>
                    {review.customerName?.trim() || "Anonymous"}
                  </s-table-cell>
                  <s-table-cell>
                    {review.productTitle?.trim() || "—"}
                  </s-table-cell>
                  <s-table-cell>{formatStars(review.rating)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">
                        {review.title?.trim() || "Untitled review"}
                      </s-text>
                      <s-text>{previewText(review.body)}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusBadgeTone(review.status)}>
                      {statusLabel(review.status)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatDate(review.createdAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table>
            <s-button href="/app/reviews" variant="tertiary">
              View all reviews
            </s-button>
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="Review status">
        <s-unordered-list>
          <s-list-item>
            <s-badge tone="success">Published</s-badge>
            {" — Visible on your storefront when widgets are enabled."}
          </s-list-item>
          <s-list-item>
            <s-badge tone="caution">Pending</s-badge>
            {" — Awaiting moderation."}
          </s-list-item>
          <s-list-item>
            <s-badge tone="critical">Rejected</s-badge>
            {" — Hidden from storefront display."}
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Moderation">
        <s-paragraph>
          Open Reviews to search, filter, publish, reject, or delete reviews for
          this store. All review data is scoped to your authenticated Shopify
          shop.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
