import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import prisma from "../../db.server";
import { recordVerifiedPurchase } from "../../services/purchase-verification.server";
import { unauthenticated } from "../../shopify.server";
import { validateReviewContent } from "../../utils/review-submission.server";
import {
  isOpenReviewRequest,
  isReviewRequestToken,
  requestIsPastExpiry,
} from "../../utils/review-requests.server";
import styles from "./styles.module.css";

type PublicView =
  | {
      state: "ready";
      productTitle: string;
      customerName: string | null;
    }
  | { state: "completed" | "expired" | "unavailable" };

type SubmitResult =
  | { ok: true; message: string }
  | { ok: false; error: string; errors?: Record<string, string> };

function unavailableView(): PublicView {
  return { state: "unavailable" };
}

function trimValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export const loader = async ({
  params,
}: LoaderFunctionArgs): Promise<PublicView> => {
  const token = params.token?.trim();
  if (!token || !isReviewRequestToken(token)) return unavailableView();

  const reviewRequest = await prisma.reviewRequest.findUnique({
    where: { token },
    select: {
      id: true,
      shop: true,
      status: true,
      expiresAt: true,
      productTitle: true,
      customerName: true,
    },
  });

  if (!reviewRequest) return unavailableView();

  if (
    isOpenReviewRequest(reviewRequest.status) &&
    requestIsPastExpiry(reviewRequest.expiresAt)
  ) {
    await prisma.reviewRequest.updateMany({
      where: {
        id: reviewRequest.id,
        shop: reviewRequest.shop,
        status: { in: ["pending", "sent"] },
      },
      data: { status: "expired" },
    });
    return { state: "expired" };
  }

  if (reviewRequest.status === "completed") return { state: "completed" };
  if (reviewRequest.status === "expired") return { state: "expired" };
  if (!isOpenReviewRequest(reviewRequest.status)) return unavailableView();

  return {
    state: "ready",
    productTitle: reviewRequest.productTitle?.trim() || "Product",
    customerName: reviewRequest.customerName?.trim() || null,
  };
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<SubmitResult> => {
  const token = params.token?.trim();
  if (!token || !isReviewRequestToken(token)) {
    return {
      ok: false,
      error: "This review request is no longer available.",
    };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: "Invalid form submission." };
  }

  const content = validateReviewContent({
    ratingRaw: trimValue(formData.get("rating")),
    titleRaw: trimValue(formData.get("title")),
    bodyRaw: trimValue(formData.get("body")),
  });

  if (!content.ok) {
    return {
      ok: false,
      error: "Please correct the highlighted fields and try again.",
      errors: content.errors,
    };
  }

  let submittedReview: {
    id: string;
    shop: string;
    productId: string;
    customerEmail: string;
  } | null = null;

  try {
    submittedReview = await prisma.$transaction(async (tx) => {
      const reviewRequest = await tx.reviewRequest.findUnique({
        where: { token },
      });

      if (!reviewRequest) {
        throw new Error("unavailable");
      }

      if (reviewRequest.status === "completed") {
        throw new Error("completed");
      }

      if (reviewRequest.status === "cancelled") {
        throw new Error("cancelled");
      }

      if (
        reviewRequest.status === "expired" ||
        (isOpenReviewRequest(reviewRequest.status) &&
          requestIsPastExpiry(reviewRequest.expiresAt))
      ) {
        if (isOpenReviewRequest(reviewRequest.status)) {
          await tx.reviewRequest.updateMany({
            where: {
              id: reviewRequest.id,
              shop: reviewRequest.shop,
              status: { in: ["pending", "sent"] },
            },
            data: { status: "expired" },
          });
        }
        throw new Error("expired");
      }

      if (!isOpenReviewRequest(reviewRequest.status)) {
        throw new Error("unavailable");
      }

      const created = await tx.review.create({
        data: {
          shop: reviewRequest.shop,
          productId: reviewRequest.productId,
          productTitle: reviewRequest.productTitle,
          customerName: reviewRequest.customerName,
          customerEmail: reviewRequest.customerEmail,
          rating: content.rating,
          title: content.title,
          body: content.body,
          status: "published",
        },
        select: { id: true },
      });
      const updated = await tx.reviewRequest.updateMany({
        where: {
          id: reviewRequest.id,
          shop: reviewRequest.shop,
          status: { in: ["pending", "sent"] },
        },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        throw new Error("completed");
      }

      return {
        id: created.id,
        shop: reviewRequest.shop,
        productId: reviewRequest.productId,
        customerEmail: reviewRequest.customerEmail,
      };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unavailable";
    if (code === "completed") {
      return {
        ok: false,
        error: "This review request has already been completed.",
      };
    }
    if (code === "expired") {
      return { ok: false, error: "This review request has expired." };
    }
    return {
      ok: false,
      error: "This review request is no longer available.",
    };
  }

  if (submittedReview) {
    try {
      const { admin } = await unauthenticated.admin(submittedReview.shop);
      await recordVerifiedPurchase({
        admin,
        shop: submittedReview.shop,
        reviewId: submittedReview.id,
        customerEmail: submittedReview.customerEmail,
        productId: submittedReview.productId,
      });
    } catch {
      console.error(
        `[rg-review] verified purchase lookup failed shop=${submittedReview.shop} review=${submittedReview.id}`,
      );
    }
  }

  return {
    ok: true,
    message:
      "Thank you for your review. Your review has been submitted and is awaiting approval.",
  };
};

export default function ReviewRequestPage() {
  const view = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData && !actionData.ok ? actionData.errors : undefined;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.brand}>RG Review</p>
        <h1 className={styles.heading}>Write a review</h1>

        {actionData?.ok ? (
          <p className={styles.success}>{actionData.message}</p>
        ) : view.state === "completed" ? (
          <p className={styles.notice}>
            This review request has already been completed.
          </p>
        ) : view.state === "expired" ? (
          <p className={styles.notice}>This review request has expired.</p>
        ) : view.state === "ready" ? (
          <>
            <p className={styles.product}>{view.productTitle}</p>
            {view.customerName ? (
              <p className={styles.muted}>For {view.customerName}</p>
            ) : (
              <p className={styles.muted}>
                Share your experience with this product. Your review will be
                reviewed before it is published.
              </p>
            )}

            {actionData && !actionData.ok ? (
              <p className={styles.error}>{actionData.error}</p>
            ) : null}

            <Form className={styles.form} method="post">
              <div className={styles.field}>
                <fieldset className={styles.rating}>
                  <legend className={styles.label}>
                    Rating <span className={styles.optional}>Required</span>
                  </legend>
                  <div className={styles.stars}>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <label className={styles.star} key={value}>
                      <input
                        type="radio"
                        name="rating"
                        value={value}
                        required={value === 1}
                      />
                      <span aria-hidden="true">★</span>
                      <span className={styles.srOnly}>
                        {value} star{value === 1 ? "" : "s"}
                      </span>
                    </label>
                  ))}
                  </div>
                </fieldset>
                {errors?.rating ? (
                  <p className={styles.error}>{errors.rating}</p>
                ) : null}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="review-request-title">
                  Review title <span className={styles.optional}>Optional</span>
                </label>
                <input
                  id="review-request-title"
                  className={styles.input}
                  type="text"
                  name="title"
                  maxLength={120}
                  autoComplete="off"
                />
                {errors?.title ? (
                  <p className={styles.error}>{errors.title}</p>
                ) : null}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="review-request-body">
                  Your review <span className={styles.optional}>Required</span>
                </label>
                <textarea
                  id="review-request-body"
                  className={styles.textarea}
                  name="body"
                  maxLength={5000}
                  required
                />
                {errors?.body ? (
                  <p className={styles.error}>{errors.body}</p>
                ) : null}
              </div>

              <button className={styles.submit} type="submit">
                Submit review
              </button>
            </Form>
          </>
        ) : (
          <p className={styles.notice}>
            This review request is no longer available.
          </p>
        )}
      </section>
    </main>
  );
}
