export const REVIEW_STATUSES = ["pending", "published", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PAGE_SIZE = 20;
export const RECENT_REVIEWS_LIMIT = 5;

export function isReviewStatus(value: string): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value);
}

export function formatStars(rating: number): string {
  const safe = Math.min(5, Math.max(0, Math.round(rating)));
  return `${"★".repeat(safe)}${"☆".repeat(5 - safe)}`;
}

export function statusBadgeTone(
  status: string,
): "success" | "caution" | "critical" | "auto" {
  switch (status) {
    case "published":
      return "success";
    case "pending":
      return "caution";
    case "rejected":
      return "critical";
    default:
      return "auto";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "published":
      return "Published";
    case "pending":
      return "Pending";
    case "rejected":
      return "Rejected";
    default:
      return status;
  }
}

export function previewText(value: string, maxLength = 80): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatAverageRating(average: number | null | undefined): string {
  if (average === null || average === undefined) return "—";
  return average.toFixed(1);
}

export function buildReviewsSearchParams(input: {
  q?: string;
  status?: string;
  rating?: string;
  page?: number;
  review?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.status) params.set("status", input.status);
  if (input.rating) params.set("rating", input.rating);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.review) params.set("review", input.review);
  const query = params.toString();
  return query ? `?${query}` : "";
}
