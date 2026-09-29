import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { Prisma } from "@prisma/client";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { formatDateTime } from "../utils/reviews";
import {
  REVIEW_REQUEST_PAGE_SIZE,
  buildReviewRequestSearchParams,
  isReviewRequestStatus,
  reviewRequestStatusLabel,
  reviewRequestStatusTone,
} from "../utils/review-requests";
import {
  createReviewRequestToken,
  expireOpenReviewRequests,
  expiresAtFromDays,
  isOpenReviewRequest,
  isProductGid,
  parseExpirySelection,
  requestIsPastExpiry,
  reviewRequestUrl,
  validateOptionalCustomerName,
} from "../utils/review-requests.server";
import { validateEmailAddress } from "../utils/review-submission.server";
import { deliverReviewEmail } from "../services/email.server";
import {
  REVIEW_EMAIL_CTA,
  emailCustomerLabel,
  emailProductLabel,
  reviewRequestSubject,
} from "../emails/content";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type StoreProduct = {
  id: string;
  title: string;
};

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; errors?: Record<string, string> };

function modalElement(id: string) {
  return document.getElementById(id) as HTMLElementTagNameMap["s-modal"] | null;
}

function trimValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

async function loadProducts(admin: AdminGraphql): Promise<StoreProduct[]> {
  const response = await admin.graphql(
    `#graphql
      query ReviewRequestProducts {
        products(first: 50, sortKey: TITLE) {
          nodes {
            id
            title
          }
        }
      }`,
  );
  const payload = await response.json();
  const nodes = payload?.data?.products?.nodes;
  if (!Array.isArray(nodes)) return [];

  return nodes.flatMap((node: { id?: string; title?: string }) => {
    if (!node?.id || typeof node.title !== "string") return [];
    return [{ id: node.id, title: node.title }];
  });
}

async function loadProduct(
  admin: AdminGraphql,
  productGid: string,
): Promise<StoreProduct | null> {
  const response = await admin.graphql(
    `#graphql
      query ReviewRequestProduct($id: ID!) {
        product(id: $id) {
          id
          title
        }
      }`,
    { variables: { id: productGid } },
  );
  const payload = await response.json();
  const product = payload?.data?.product;
  if (!product?.id || typeof product.title !== "string") return null;
  return { id: product.id, title: product.title };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const statusParam = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const status = isReviewRequestStatus(statusParam) ? statusParam : "";
  const product = isProductGid((url.searchParams.get("product") ?? "").trim())
    ? (url.searchParams.get("product") ?? "").trim()
    : "";
  let page = parsePage(url.searchParams.get("page"));
  const requestId = (url.searchParams.get("request") ?? "").trim();

  await expireOpenReviewRequests(shop);

  const where: Prisma.ReviewRequestWhereInput = {
    shop,
    ...(status ? { status } : {}),
    ...(product ? { productId: product } : {}),
    ...(q
      ? {
          OR: [
            { customerName: { contains: q } },
            { customerEmail: { contains: q } },
            { productTitle: { contains: q } },
          ],
        }
      : {}),
  };

  let products: StoreProduct[] = [];
  let productsError: string | null = null;
  try {
    products = await loadProducts(admin);
  } catch {
    productsError = "Unable to load products from Shopify right now.";
  }

  try {
    const [total, pending, sent, completed, totalCount] = await Promise.all([
      prisma.reviewRequest.count({ where: { shop } }),
      prisma.reviewRequest.count({ where: { shop, status: "pending" } }),
      prisma.reviewRequest.count({ where: { shop, status: "sent" } }),
      prisma.reviewRequest.count({ where: { shop, status: "completed" } }),
      prisma.reviewRequest.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / REVIEW_REQUEST_PAGE_SIZE));
    if (page > totalPages) page = totalPages;

    const [requests, selected] = await Promise.all([
      prisma.reviewRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * REVIEW_REQUEST_PAGE_SIZE,
        take: REVIEW_REQUEST_PAGE_SIZE,
        select: {
          id: true,
          token: true,
          customerName: true,
          customerEmail: true,
          productTitle: true,
          productId: true,
          status: true,
          sentAt: true,
          completedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      requestId
        ? prisma.reviewRequest.findFirst({
            where: { id: requestId, shop },
          })
        : Promise.resolve(null),
    ]);

    return {
      shop,
      products,
      productsError,
      filters: { q, status, product },
      stats: { total, pending, sent, completed },
      pagination: {
        page,
        pageSize: REVIEW_REQUEST_PAGE_SIZE,
        totalCount,
        totalPages,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
      requests: requests.map(({ token, ...item }) => ({
        ...item,
        reviewLink: reviewRequestUrl(token),
      })),
      selectedRequest: selected
        ? {
            id: selected.id,
            customerName: selected.customerName,
            customerEmail: selected.customerEmail,
            productTitle: selected.productTitle,
            productId: selected.productId,
            status: selected.status,
            sentAt: selected.sentAt,
            completedAt: selected.completedAt,
            expiresAt: selected.expiresAt,
            createdAt: selected.createdAt,
            reviewLink: reviewRequestUrl(selected.token),
          }
        : null,
      selectedMissing: Boolean(requestId && !selected),
      loadError: null as string | null,
    };
  } catch {
    return {
      shop,
      products,
      productsError,
      filters: { q, status, product },
      stats: { total: 0, pending: 0, sent: 0, completed: 0 },
      pagination: {
        page: 1,
        pageSize: REVIEW_REQUEST_PAGE_SIZE,
        totalCount: 0,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
      requests: [],
      selectedRequest: null,
      selectedMissing: false,
      loadError: "Unable to load review requests right now.",
    };
  }
};

async function sendReviewRequestEmail(input: {
  shop: string;
  id: string;
  mode: "send" | "resend";
}): Promise<ActionResult> {
  const reviewRequest = await prisma.reviewRequest.findFirst({
    where: { id: input.id, shop: input.shop },
  });

  if (!reviewRequest) return { ok: false, error: "Review request not found." };

  if (
    isOpenReviewRequest(reviewRequest.status) &&
    requestIsPastExpiry(reviewRequest.expiresAt)
  ) {
    await prisma.reviewRequest.updateMany({
      where: {
        id: reviewRequest.id,
        shop: input.shop,
        status: { in: ["pending", "sent"] },
      },
      data: { status: "expired" },
    });
    return { ok: false, error: "This review request has expired." };
  }

  if (reviewRequest.status === "completed") {
    return { ok: false, error: "Completed requests cannot be emailed." };
  }
  if (reviewRequest.status === "cancelled") {
    return { ok: false, error: "Cancelled requests cannot be emailed." };
  }
  if (reviewRequest.status === "expired") {
    return { ok: false, error: "This review request has expired." };
  }
  if (input.mode === "send" && reviewRequest.status !== "pending") {
    return { ok: false, error: "Only pending requests can be emailed." };
  }
  if (input.mode === "resend" && reviewRequest.status !== "sent") {
    return { ok: false, error: "Only sent requests can be resent." };
  }

  const emailError = validateEmailAddress(reviewRequest.customerEmail);
  if (emailError) return { ok: false, error: emailError };

  const reviewUrl = reviewRequestUrl(reviewRequest.token);
  if (!reviewUrl) {
    return {
      ok: false,
      error:
        "The review link is unavailable because the app URL is not configured.",
    };
  }

  const claimed = await prisma.reviewRequest.updateMany({
    where: {
      id: reviewRequest.id,
      shop: input.shop,
      status: input.mode === "send" ? "pending" : "sent",
      updatedAt: reviewRequest.updatedAt,
    },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return {
      ok: false,
      error:
        "This request is already being emailed. Refresh and try again if it is still waiting.",
    };
  }

  const delivered = await deliverReviewEmail({
    kind: "request",
    to: reviewRequest.customerEmail,
    customerName: reviewRequest.customerName,
    productTitle: reviewRequest.productTitle,
    reviewUrl,
    shop: input.shop,
    requestId: reviewRequest.id,
    logEvent: input.mode === "resend" ? "email resent" : "email sent",
  });

  if (!delivered.ok) return delivered;

  if (input.mode === "send") {
    const updated = await prisma.reviewRequest.updateMany({
      where: { id: reviewRequest.id, shop: input.shop, status: "pending" },
      data: { status: "sent", sentAt: new Date() },
    });
    if (updated.count !== 1) {
      return {
        ok: false,
        error: "The email was sent, but the request status could not be updated.",
      };
    }
    return { ok: true, message: "Review email sent" };
  }

  const updated = await prisma.reviewRequest.updateMany({
    where: { id: reviewRequest.id, shop: input.shop, status: "sent" },
    data: { sentAt: new Date() },
  });
  if (updated.count !== 1) {
    return {
      ok: false,
      error: "The email was sent, but the request could not be updated.",
    };
  }
  return { ok: true, message: "Review email resent" };
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = trimValue(formData.get("intent"));

  if (intent === "create") {
    const customerName = trimValue(formData.get("customerName"));
    const customerEmail = trimValue(formData.get("customerEmail")).toLowerCase();
    const productGid = trimValue(formData.get("productId"));
    const expirySelection = parseExpirySelection(
      trimValue(formData.get("expiresInDays")),
    );
    const errors: Record<string, string> = {};

    const nameError = validateOptionalCustomerName(customerName);
    if (nameError) errors.customerName = nameError;

    const emailError = validateEmailAddress(customerEmail);
    if (emailError) errors.customerEmail = emailError;

    if (!isProductGid(productGid)) {
      errors.productId = "Select a product from your store.";
    }

    if (!expirySelection.ok) {
      errors.expiresInDays = "Choose a valid expiration option.";
    }

    if (Object.keys(errors).length > 0 || !expirySelection.ok) {
      return {
        ok: false,
        error: "Please correct the highlighted fields and try again.",
        errors,
      };
    }

    let product: StoreProduct | null;
    try {
      product = await loadProduct(admin, productGid);
    } catch {
      return {
        ok: false,
        error: "Unable to verify the selected product. Please try again.",
      };
    }

    if (!product) {
      return {
        ok: false,
        error: "That product could not be found in your store.",
        errors: { productId: "Select a valid product." },
      };
    }

    try {
      await prisma.reviewRequest.create({
        data: {
          shop,
          token: createReviewRequestToken(),
          customerName: customerName || null,
          customerEmail,
          productId: product.id,
          productTitle: product.title,
          status: "pending",
          expiresAt: expiresAtFromDays(expirySelection.days),
        },
      });
    } catch {
      return {
        ok: false,
        error: "Unable to create the review request right now.",
      };
    }

    return { ok: true, message: "Review request created" };
  }

  if (intent === "bulk_send") {
    const ids = trimValue(formData.get("ids"))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 50);

    if (ids.length === 0) {
      return { ok: false, error: "Select at least one pending request." };
    }

    let sent = 0;
    let failed = 0;

    for (const requestId of ids) {
      const result = await sendReviewRequestEmail({
        shop,
        id: requestId,
        mode: "send",
      });
      if (result.ok) sent += 1;
      else failed += 1;
    }

    if (sent === 0) {
      return {
        ok: false,
        error: `No emails were sent. ${failed} failed.`,
      };
    }

    return {
      ok: true,
      message:
        failed > 0
          ? `Sent ${sent} review ${sent === 1 ? "email" : "emails"}. ${failed} failed.`
          : `Sent ${sent} review ${sent === 1 ? "email" : "emails"}.`,
    };
  }

  const id = trimValue(formData.get("id"));
  if (!id) return { ok: false, error: "Invalid review request." };

  if (intent === "send_email" || intent === "resend_email") {
    return sendReviewRequestEmail({
      shop,
      id,
      mode: intent === "resend_email" ? "resend" : "send",
    });
  }

  const owned = await prisma.reviewRequest.findFirst({
    where: { id, shop },
    select: { id: true, status: true },
  });

  if (!owned) return { ok: false, error: "Review request not found." };

  if (intent === "cancel") {
    if (!isOpenReviewRequest(owned.status)) {
      return {
        ok: false,
        error: "Only pending or sent requests can be cancelled.",
      };
    }

    const updated = await prisma.reviewRequest.updateMany({
      where: {
        id: owned.id,
        shop,
        status: { in: ["pending", "sent"] },
      },
      data: { status: "cancelled" },
    });

    if (updated.count !== 1) {
      return { ok: false, error: "Review request could not be cancelled." };
    }

    return { ok: true, message: "Review request cancelled" };
  }

  if (intent === "delete") {
    const deleted = await prisma.reviewRequest.deleteMany({
      where: { id: owned.id, shop },
    });

    if (deleted.count !== 1) {
      return { ok: false, error: "Review request could not be deleted." };
    }

    return { ok: true, message: "Review request deleted" };
  }

  return { ok: false, error: "Invalid action." };
};

export default function ReviewRequestsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const isActing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (!fetcher.data) return;
      if (fetcher.data.ok) {
      shopify.toast.show(fetcher.data.message);
      if (fetcher.formData?.get("intent") === "bulk_send") {
        setSelectedIds([]);
      }
      if (fetcher.formData?.get("intent") === "create") {
        modalElement("create-request-modal")?.hideOverlay();
      }
      if (fetcher.formData?.get("intent") === "delete") {
        modalElement("delete-request-modal")?.hideOverlay();
        setDeleteId(null);
        if (searchParams.get("request")) {
          const next = new URLSearchParams(searchParams);
          next.delete("request");
          setSearchParams(next);
        }
      }
    } else {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, fetcher.formData, searchParams, setSearchParams, shopify]);

  useEffect(() => {
    if (data.selectedRequest) {
      modalElement("request-detail-modal")?.showOverlay();
    }
  }, [data.selectedRequest]);

  useEffect(() => {
    if (data.selectedMissing) {
      shopify.toast.show("Review request not found.", { isError: true });
    }
  }, [data.selectedMissing, shopify]);

  if (data.loadError) {
    return (
      <s-page heading="Review Requests">
        <s-banner tone="critical" heading="Could not load review requests">
          <s-paragraph>{data.loadError}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }

  const filterQuery = data.filters;
  const pageHref = (page: number) =>
    `/app/review-requests${buildReviewRequestSearchParams({
      ...filterQuery,
      page,
      request: data.selectedRequest?.id ?? null,
    })}`;

  const detailHref = (id: string) =>
    `/app/review-requests${buildReviewRequestSearchParams({
      ...filterQuery,
      page: data.pagination.page,
      request: id,
    })}`;

  const submitAction = (intent: string, id: string) => {
    fetcher.submit({ intent, id }, { method: "POST" });
  };

  const copyLink = async (url: string | null) => {
    if (!url) {
      shopify.toast.show("Review link is unavailable right now.", {
        isError: true,
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      shopify.toast.show("Review link copied");
    } catch {
      shopify.toast.show(
        "Unable to copy automatically. Select the link from the request details.",
        { isError: true },
      );
    }
  };

  const createErrors =
    fetcher.data && !fetcher.data.ok ? fetcher.data.errors : undefined;
  const pendingIds = data.requests
    .filter((item) => item.status === "pending")
    .map((item) => item.id);
  const allPendingSelected =
    pendingIds.length > 0 &&
    pendingIds.every((id) => selectedIds.includes(id));
  const preview = data.requests.find((item) => item.id === previewId) ?? null;

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    );
  };

  const sendSelected = () => {
    const ids = selectedIds.filter((id) => pendingIds.includes(id));
    if (ids.length === 0) {
      shopify.toast.show("Select at least one pending request.", { isError: true });
      return;
    }
    fetcher.submit({ intent: "bulk_send", ids: ids.join(",") }, { method: "POST" });
  };

  return (
    <s-page heading="Review Requests">
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="create-request-modal"
        command="--show"
      >
        Create Review Request
      </s-button>

      <s-section>
        <s-paragraph>
          Send customers a secure link to leave a review for their purchased
          product.
        </s-paragraph>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <Stat label="Total Requests" value={data.stats.total} />
          <Stat label="Pending" value={data.stats.pending} />
          <Stat label="Sent" value={data.stats.sent} />
          <Stat label="Completed" value={data.stats.completed} />
        </s-stack>
      </s-section>

      <s-section heading="Filters">
        <Form method="get">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text-field
                name="q"
                label="Search"
                value={data.filters.q}
                placeholder="Customer or product"
                autocomplete="off"
              />
              <s-select name="status" label="Status" value={data.filters.status}>
                <s-option value="">All</s-option>
                <s-option value="pending">Pending</s-option>
                <s-option value="sent">Sent</s-option>
                <s-option value="completed">Completed</s-option>
                <s-option value="cancelled">Cancelled</s-option>
                <s-option value="expired">Expired</s-option>
              </s-select>
              <s-select
                name="product"
                label="Product"
                value={data.filters.product}
              >
                <s-option value="">All products</s-option>
                {data.products.map((product) => (
                  <s-option key={product.id} value={product.id}>
                    {product.title}
                  </s-option>
                ))}
              </s-select>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-button type="submit" variant="primary">
                Apply filters
              </s-button>
              <s-button href="/app/review-requests" variant="tertiary">
                Clear filters
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Requests">
        {data.requests.length === 0 ? (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>No review requests yet</s-heading>
              <s-paragraph>
                {data.filters.q || data.filters.status || data.filters.product
                  ? "No review requests match your current filters."
                  : "Create a request when you want a customer to review a specific product. Nothing has been created for this store yet."}
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Showing{" "}
              {(data.pagination.page - 1) * data.pagination.pageSize + 1}–
              {Math.min(
                data.pagination.page * data.pagination.pageSize,
                data.pagination.totalCount,
              )}{" "}
              of {data.pagination.totalCount} requests
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                disabled={selectedIds.length === 0}
                onClick={sendSelected}
                {...(isActing ? { loading: true } : {})}
              >
                Bulk Send
              </s-button>
            </s-stack>
            <s-table>
              <s-table-header-row>
                <s-table-header>
                  <s-checkbox
                    label="Select all pending requests"
                    labelAccessibilityVisibility="exclusive"
                    checked={allPendingSelected}
                    disabled={pendingIds.length === 0}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedIds(checked ? pendingIds : []);
                    }}
                  />
                </s-table-header>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="secondary">Product</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Created</s-table-header>
                <s-table-header>Sent</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              {data.requests.map((item) => (
                <s-table-row key={item.id}>
                  <s-table-cell>
                    <s-checkbox
                      label={`Select ${item.customerEmail}`}
                      labelAccessibilityVisibility="exclusive"
                      checked={selectedIds.includes(item.id)}
                      disabled={item.status !== "pending"}
                      onChange={(event) =>
                        toggleSelected(item.id, event.currentTarget.checked)
                      }
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">
                        {item.customerName?.trim() || "—"}
                      </s-text>
                      <s-text>{item.customerEmail}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{item.productTitle?.trim() || "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={reviewRequestStatusTone(item.status)}>
                      {reviewRequestStatusLabel(item.status)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatDateTime(item.createdAt)}</s-table-cell>
                  <s-table-cell>
                    {item.sentAt ? formatDateTime(item.sentAt) : "—"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button href={detailHref(item.id)} variant="tertiary">
                        View
                      </s-button>
                      <s-button
                        variant="tertiary"
                        commandFor="email-preview-modal"
                        command="--show"
                        onClick={() => setPreviewId(item.id)}
                      >
                        Preview
                      </s-button>
                      <s-button
                        variant="tertiary"
                        onClick={() => copyLink(item.reviewLink)}
                      >
                        Copy Review Link
                      </s-button>
                      {item.status === "pending" ? (
                        <s-button
                          variant="tertiary"
                          onClick={() => submitAction("send_email", item.id)}
                          {...(isActing ? { loading: true } : {})}
                        >
                          Send Email
                        </s-button>
                      ) : null}
                      {item.status === "sent" ? (
                        <s-button
                          variant="tertiary"
                          onClick={() => submitAction("resend_email", item.id)}
                          {...(isActing ? { loading: true } : {})}
                        >
                          Resend Email
                        </s-button>
                      ) : null}
                      {item.status === "pending" || item.status === "sent" ? (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => submitAction("cancel", item.id)}
                          {...(isActing ? { loading: true } : {})}
                        >
                          Cancel
                        </s-button>
                      ) : null}
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        commandFor="delete-request-modal"
                        command="--show"
                        onClick={() => setDeleteId(item.id)}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table>
            {data.pagination.totalPages > 1 ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button
                  href={pageHref(data.pagination.page - 1)}
                  variant="secondary"
                  disabled={!data.pagination.hasPreviousPage}
                >
                  Previous
                </s-button>
                <s-text>
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </s-text>
                <s-button
                  href={pageHref(data.pagination.page + 1)}
                  variant="secondary"
                  disabled={!data.pagination.hasNextPage}
                >
                  Next
                </s-button>
              </s-stack>
            ) : null}
          </s-stack>
        )}
      </s-section>

      <s-modal id="create-request-modal" heading="Create Review Request">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Creates a pending request and a secure review link. Use Send Email
              when you want the customer to receive it. Creating a request does
              not send an email by itself.
            </s-paragraph>
            {data.productsError ? (
              <s-banner tone="critical" heading="Products unavailable">
                <s-paragraph>{data.productsError}</s-paragraph>
              </s-banner>
            ) : null}
            <s-text-field
              label="Customer name"
              name="customerName"
              autocomplete="on"
              details="Optional"
              error={createErrors?.customerName}
            />
            <s-text-field
              label="Customer email"
              name="customerEmail"
              autocomplete="on"
              required
              error={createErrors?.customerEmail}
            />
            <s-select
              label="Product"
              name="productId"
              required
              error={createErrors?.productId}
            >
              <s-option value="">Select a product</s-option>
              {data.products.map((product) => (
                <s-option key={product.id} value={product.id}>
                  {product.title}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Link expiration"
              name="expiresInDays"
              details="Optional. Leave blank if the link should not expire."
              error={createErrors?.expiresInDays}
            >
              <s-option value="">Does not expire</s-option>
              <s-option value="7">7 days</s-option>
              <s-option value="14">14 days</s-option>
              <s-option value="30">30 days</s-option>
              <s-option value="90">90 days</s-option>
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              {...(isActing ? { loading: true } : {})}
            >
              Create request
            </s-button>
          </s-stack>
        </fetcher.Form>
        <s-button
          slot="secondary-actions"
          commandFor="create-request-modal"
          command="--hide"
        >
          Close
        </s-button>
      </s-modal>

      <s-modal id="request-detail-modal" heading="Review request">
        {data.selectedRequest ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              <s-text type="strong">Customer name: </s-text>
              {data.selectedRequest.customerName?.trim() || "—"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Customer email: </s-text>
              {data.selectedRequest.customerEmail}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Product: </s-text>
              {data.selectedRequest.productTitle?.trim() || "—"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Status: </s-text>
              <s-badge tone={reviewRequestStatusTone(data.selectedRequest.status)}>
                {reviewRequestStatusLabel(data.selectedRequest.status)}
              </s-badge>
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Created: </s-text>
              {formatDateTime(data.selectedRequest.createdAt)}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Sent: </s-text>
              {data.selectedRequest.sentAt
                ? formatDateTime(data.selectedRequest.sentAt)
                : "—"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Completed: </s-text>
              {data.selectedRequest.completedAt
                ? formatDateTime(data.selectedRequest.completedAt)
                : "—"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Expiration: </s-text>
              {data.selectedRequest.expiresAt
                ? formatDateTime(data.selectedRequest.expiresAt)
                : "Does not expire"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Review link: </s-text>
              {data.selectedRequest.reviewLink || "Unavailable"}
            </s-paragraph>
          </s-stack>
        ) : (
          <s-paragraph>Select a request to view details.</s-paragraph>
        )}
        {data.selectedRequest ? (
          <s-button
            slot="secondary-actions"
            onClick={() => copyLink(data.selectedRequest?.reviewLink ?? null)}
          >
            Copy Review Link
          </s-button>
        ) : null}
        <s-button
          slot="secondary-actions"
          commandFor="request-detail-modal"
          command="--hide"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("request");
            setSearchParams(next);
          }}
        >
          Close
        </s-button>
      </s-modal>

      <s-modal id="email-preview-modal" heading="Email preview">
        {preview ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              This preview is not sent. Use Send Email when you are ready.
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Subject: </s-text>
              {reviewRequestSubject(preview.productTitle)}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">To: </s-text>
              {emailCustomerLabel(preview.customerName)} ({preview.customerEmail})
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Product: </s-text>
              {emailProductLabel(preview.productTitle)}
            </s-paragraph>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="base">
                <s-text type="strong">RG Review</s-text>
                <s-paragraph>
                  Hi {emailCustomerLabel(preview.customerName)},
                </s-paragraph>
                <s-paragraph>
                  We would love to hear how this product worked for you.
                </s-paragraph>
                <s-text type="strong">{emailProductLabel(preview.productTitle)}</s-text>
                <s-button
                  variant="primary"
                  {...(preview.reviewLink
                    ? { href: preview.reviewLink }
                    : { disabled: true })}
                >
                  {REVIEW_EMAIL_CTA}
                </s-button>
              </s-stack>
            </s-box>
          </s-stack>
        ) : (
          <s-paragraph>Select a request to preview its email.</s-paragraph>
        )}
        <s-button
          slot="secondary-actions"
          commandFor="email-preview-modal"
          command="--hide"
        >
          Close
        </s-button>
      </s-modal>

      <s-modal id="delete-request-modal" heading="Delete review request?">
        <s-paragraph>
          This deletes the request only. Any review already submitted from this
          request stays in Reviews.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="delete-request-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          tone="critical"
          {...(isActing ? { loading: true } : {})}
          onClick={() => {
            if (deleteId) submitAction("delete", deleteId);
          }}
        >
          Delete request
        </s-button>
      </s-modal>
    </s-page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
      minInlineSize="120px"
    >
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
