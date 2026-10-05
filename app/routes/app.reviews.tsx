import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { Prisma } from "@prisma/client";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { useAdminHref } from "../components/admin/ui";
import prisma from "../db.server";
import { issueRewardForPublishedReview } from "../services/rewards.server";
import { authenticate } from "../shopify.server";
import {
  PAGE_SIZE,
  buildReviewsSearchParams,
  formatDate,
  formatDateTime,
  formatStars,
  isReviewStatus,
  previewText,
  statusBadgeTone,
  statusLabel,
} from "../utils/reviews";

type ActionResult =
  | { ok: true; message: string; deleted?: boolean }
  | { ok: false; error: string };

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function reviewTab(value: string | null): "published" | "rejected" {
  return value?.trim().toLowerCase() === "rejected" ? "rejected" : "published";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const status = reviewTab(url.searchParams.get("status"));
  let page = parsePage(url.searchParams.get("page"));
  const reviewId = (url.searchParams.get("review") ?? "").trim() || null;

  const where: Prisma.ReviewWhereInput = { shop, status };

  try {
    const [totalCount, publishedCount, rejectedCount] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.count({ where: { shop, status: "published" } }),
      prisma.review.count({ where: { shop, status: "rejected" } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (page > totalPages) page = totalPages;

    const [reviews, selectedReview] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          customerName: true,
          customerEmail: true,
          productTitle: true,
          productId: true,
          rating: true,
          title: true,
          body: true,
          status: true,
          verifiedPurchase: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      reviewId
        ? prisma.review.findFirst({
            where: { id: reviewId, shop },
          })
        : Promise.resolve(null),
    ]);

    return {
      shop,
      filters: { status },
      counts: { published: publishedCount, rejected: rejectedCount },
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalCount,
        totalPages,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
      reviews,
      selectedReview,
      selectedReviewMissing: Boolean(reviewId && !selectedReview),
    };
  } catch {
    return {
      shop,
      filters: { status },
      counts: { published: 0, rejected: 0 },
      pagination: {
        page: 1,
        pageSize: PAGE_SIZE,
        totalCount: 0,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
      reviews: [],
      selectedReview: null,
      selectedReviewMissing: false,
      loadError: "Unable to load reviews right now. Please try again.",
    };
  }
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const intent = String(formData.get("intent") ?? "");
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { ok: false, error: "Invalid review." };
  }

  try {
    const owned = await prisma.review.findFirst({
      where: { id, shop },
      select: { id: true, status: true },
    });

    if (!owned) {
      return { ok: false, error: "Review not found." };
    }

    if (intent === "delete") {
      const reward = await prisma.reviewReward.findFirst({
        where: { reviewId: owned.id, shop },
        select: { id: true, shopifyDiscountId: true },
      });
      if (reward?.shopifyDiscountId) {
        return {
          ok: false,
          error: "This review has a reward and cannot be deleted.",
        };
      }
      if (reward) {
        await prisma.reviewReward.deleteMany({
          where: { id: reward.id, shop, shopifyDiscountId: null },
        });
      }
      const deleted = await prisma.review.deleteMany({
        where: { id: owned.id, shop },
      });
      if (deleted.count === 0) {
        return { ok: false, error: "Review could not be deleted." };
      }
      return { ok: true, message: "Review deleted", deleted: true };
    }

    let nextStatus: string | null = null;
    if (intent === "publish") nextStatus = "published";
    if (intent === "pending") nextStatus = "pending";
    if (intent === "reject") nextStatus = "rejected";

    if (!nextStatus || !isReviewStatus(nextStatus)) {
      return { ok: false, error: "Invalid action." };
    }

    const updated = await prisma.review.updateMany({
      where: { id: owned.id, shop },
      data: { status: nextStatus },
    });

    if (updated.count === 0) {
      return { ok: false, error: "Review could not be updated." };
    }

    if (nextStatus === "published") {
      try {
        const reward = await issueRewardForPublishedReview({
          admin,
          shop,
          reviewId: owned.id,
        });
        return { ok: true, message: reward.message };
      } catch {
        console.error(
          `[rg-review] reward issuance failed shop=${shop} review=${owned.id}`,
        );
        return {
          ok: true,
          message:
            "Review marked as published. The reward could not be created.",
        };
      }
    }

    return {
      ok: true,
      message: `Review marked as ${statusLabel(nextStatus).toLowerCase()}`,
    };
  } catch {
    return {
      ok: false,
      error: "Something went wrong while updating the review.",
    };
  }
};

export default function ReviewsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const detailModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const deleteModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);

  const isActing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show(fetcher.data.message);
      if (fetcher.data.deleted) {
        deleteModalRef.current?.hideOverlay?.();
        detailModalRef.current?.hideOverlay?.();
        const next = new URLSearchParams(searchParams);
        next.delete("review");
        const query = next.toString();
        navigate(query ? `/app/reviews?${query}` : "/app/reviews");
      }
    } else {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, navigate, searchParams, shopify]);

  useEffect(() => {
    if (data.selectedReview) {
      detailModalRef.current?.showOverlay?.();
    }
  }, [data.selectedReview]);

  useEffect(() => {
    if (data.selectedReviewMissing) {
      shopify.toast.show("Review not found.", { isError: true });
    }
  }, [data.selectedReviewMissing, shopify]);

  if ("loadError" in data && data.loadError) {
    return (
      <s-page heading="Reviews">
        <s-banner tone="critical" heading="Could not load reviews">
          <s-paragraph>{data.loadError}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  const filterQuery = { status: data.filters.status };

  const hrefFor = useAdminHref();
  const pageHref = (page: number) =>
    hrefFor(
      `/app/reviews${buildReviewsSearchParams({
        ...filterQuery,
        page,
        review: data.selectedReview?.id ?? null,
      })}`,
    );

  const reviewHref = (reviewId: string) =>
    hrefFor(
      `/app/reviews${buildReviewsSearchParams({
        ...filterQuery,
        page: data.pagination.page,
        review: reviewId,
      })}`,
    );

  const closeDetailHref = hrefFor(
    `/app/reviews${buildReviewsSearchParams({
      ...filterQuery,
      page: data.pagination.page,
    })}`,
  );

  const submitAction = (intent: string, id: string) => {
    fetcher.submit({ intent, id }, { method: "POST" });
  };

  const tabHref = (status: "published" | "rejected") =>
    hrefFor(`/app/reviews${buildReviewsSearchParams({ status })}`);

  return (
    <s-page heading="Reviews">
      <s-section>
        <s-paragraph>
          Manage and moderate customer reviews for your store.
        </s-paragraph>
      </s-section>

      <s-section>
        <s-stack direction="inline" gap="small-200">
          <s-button
            variant={data.filters.status === "published" ? "primary" : "secondary"}
            onClick={() => navigate(tabHref("published"))}
          >
            Published ({data.counts.published})
          </s-button>
          <s-button
            variant={data.filters.status === "rejected" ? "primary" : "secondary"}
            {...(data.filters.status === "rejected" ? { tone: "critical" as const } : {})}
            onClick={() => navigate(tabHref("rejected"))}
          >
            Rejected ({data.counts.rejected})
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={data.filters.status === "published" ? "Published reviews" : "Rejected reviews"}>
        {data.reviews.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>
                {data.filters.status === "published" ? "No published reviews" : "No rejected reviews"}
              </s-heading>
              <s-paragraph>
                {data.filters.status === "published"
                  ? "Published reviews will appear in this tab."
                  : "Rejected reviews will appear in this tab."}
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Showing {(data.pagination.page - 1) * data.pagination.pageSize + 1}
              –
              {Math.min(
                data.pagination.page * data.pagination.pageSize,
                data.pagination.totalCount,
              )}{" "}
              of {data.pagination.totalCount} reviews
            </s-paragraph>

            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="secondary">Product</s-table-header>
                <s-table-header>Rating</s-table-header>
                <s-table-header>Review</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Date</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.reviews.map((review) => (
                  <s-table-row key={review.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-200">
                      <s-text>
                        {review.customerName?.trim() || "Anonymous"}
                      </s-text>
                      {review.verifiedPurchase ? (
                        <s-badge tone="success">Verified Purchase</s-badge>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {review.productTitle?.trim() || "—"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="none">
                      <s-text>{formatStars(review.rating)}</s-text>
                      <s-text>{review.rating}/5</s-text>
                    </s-stack>
                  </s-table-cell>
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
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="tertiary"
                        onClick={() => navigate(reviewHref(review.id))}
                      >
                        View
                      </s-button>
                      {review.status !== "published" ? (
                        <s-button
                          variant="tertiary"
                          {...(isActing ? { loading: true } : {})}
                          onClick={() => submitAction("publish", review.id)}
                        >
                          Publish
                        </s-button>
                      ) : null}
                      {review.status !== "pending" ? (
                        <s-button
                          variant="tertiary"
                          {...(isActing ? { loading: true } : {})}
                          onClick={() => submitAction("pending", review.id)}
                        >
                          Pending
                        </s-button>
                      ) : null}
                      {review.status !== "rejected" ? (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          {...(isActing ? { loading: true } : {})}
                          onClick={() => submitAction("reject", review.id)}
                        >
                          Reject
                        </s-button>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {data.pagination.totalPages > 1 ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button
                  variant="secondary"
                  {...(data.pagination.hasPreviousPage ? {} : { disabled: true })}
                  onClick={() => navigate(pageHref(data.pagination.page - 1))}
                >
                  Previous
                </s-button>
                <s-text>
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </s-text>
                <s-button
                  variant="secondary"
                  {...(data.pagination.hasNextPage ? {} : { disabled: true })}
                  onClick={() => navigate(pageHref(data.pagination.page + 1))}
                >
                  Next
                </s-button>
              </s-stack>
            ) : null}
          </s-stack>
        )}
      </s-section>

      <s-modal
        id="review-detail-modal"
        heading="Review details"
        ref={detailModalRef}
        onHide={() => {
          if (searchParams.get("review")) {
            navigate(closeDetailHref);
          }
        }}
      >
        {data.selectedReview ? (
          <s-stack direction="block" gap="base">
            <s-section heading="Customer">
              <s-paragraph>
                <s-text type="strong">Name: </s-text>
                {data.selectedReview.customerName?.trim() || "Anonymous"}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Email: </s-text>
                {data.selectedReview.customerEmail?.trim() || "—"}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Purchase: </s-text>
                {data.selectedReview.verifiedPurchase
                  ? "Verified Purchase"
                  : "Not verified"}
              </s-paragraph>
            </s-section>

            <s-section heading="Review">
              <s-paragraph>
                <s-text type="strong">Title: </s-text>
                {data.selectedReview.title?.trim() || "Untitled review"}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Rating: </s-text>
                {formatStars(data.selectedReview.rating)} (
                {data.selectedReview.rating}/5)
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Status: </s-text>
                <s-badge tone={statusBadgeTone(data.selectedReview.status)}>
                  {statusLabel(data.selectedReview.status)}
                </s-badge>
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Body: </s-text>
                {data.selectedReview.body}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Created: </s-text>
                {formatDateTime(data.selectedReview.createdAt)}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Updated: </s-text>
                {formatDateTime(data.selectedReview.updatedAt)}
              </s-paragraph>
            </s-section>

            <s-section heading="Product">
              <s-paragraph>
                <s-text type="strong">Title: </s-text>
                {data.selectedReview.productTitle?.trim() || "—"}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">Product ID: </s-text>
                {data.selectedReview.productId?.trim() || "—"}
              </s-paragraph>
            </s-section>
          </s-stack>
        ) : (
          <s-paragraph>Select a review to view details.</s-paragraph>
        )}

        <s-button
          slot="secondary-actions"
          commandFor="review-detail-modal"
          command="--hide"
        >
          Close
        </s-button>
        {data.selectedReview ? (
          <>
            {data.selectedReview.status !== "published" ? (
              <s-button
                slot="secondary-actions"
                {...(isActing ? { loading: true } : {})}
                onClick={() =>
                  submitAction("publish", data.selectedReview!.id)
                }
              >
                Publish
              </s-button>
            ) : null}
            {data.selectedReview.status !== "pending" ? (
              <s-button
                slot="secondary-actions"
                {...(isActing ? { loading: true } : {})}
                onClick={() =>
                  submitAction("pending", data.selectedReview!.id)
                }
              >
                Set pending
              </s-button>
            ) : null}
            {data.selectedReview.status !== "rejected" ? (
              <s-button
                slot="secondary-actions"
                tone="critical"
                {...(isActing ? { loading: true } : {})}
                onClick={() => submitAction("reject", data.selectedReview!.id)}
              >
                Reject
              </s-button>
            ) : null}
            <s-button
              slot="primary-action"
              tone="critical"
              commandFor="review-delete-modal"
              command="--show"
            >
              Delete
            </s-button>
          </>
        ) : null}
      </s-modal>

      <s-modal
        id="review-delete-modal"
        heading="Delete review?"
        ref={deleteModalRef}
      >
        <s-paragraph>
          This permanently deletes the review from your store&apos;s database.
          This action cannot be undone.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="review-delete-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          tone="critical"
          {...(isActing ? { loading: true } : {})}
          onClick={() => {
            if (data.selectedReview) {
              submitAction("delete", data.selectedReview.id);
            }
          }}
        >
          Delete review
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
