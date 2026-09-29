export const REVIEW_REQUEST_STATUSES = [
  "pending",
  "sent",
  "completed",
  "cancelled",
  "expired",
] as const;

export type ReviewRequestStatus = (typeof REVIEW_REQUEST_STATUSES)[number];

export const REVIEW_REQUEST_PAGE_SIZE = 20;
export const REVIEW_REQUEST_EXPIRY_OPTIONS = [7, 14, 30, 90] as const;

export function isReviewRequestStatus(
  value: string,
): value is ReviewRequestStatus {
  return (REVIEW_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function reviewRequestStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "sent":
      return "Sent";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

export function reviewRequestStatusTone(
  status: string,
): "success" | "caution" | "critical" | "info" | "auto" {
  switch (status) {
    case "completed":
      return "success";
    case "pending":
      return "caution";
    case "sent":
      return "info";
    case "cancelled":
    case "expired":
      return "critical";
    default:
      return "auto";
  }
}

export function buildReviewRequestSearchParams(input: {
  q?: string;
  status?: string;
  product?: string;
  page?: number;
  request?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.status) params.set("status", input.status);
  if (input.product) params.set("product", input.product);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.request) params.set("request", input.request);
  const query = params.toString();
  return query ? `?${query}` : "";
}
