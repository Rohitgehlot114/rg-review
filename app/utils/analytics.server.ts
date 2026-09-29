import { Prisma } from "@prisma/client";

import prisma from "../db.server";
import { csvCell as escapeCsvCell } from "./csv";

export const MIN_REVIEWS_FOR_RANKING = 2;
const ACTIVITY_LIMIT = 25;

export type AnalyticsRangeKey = "7" | "30" | "90" | "365" | "all" | "custom";
export type TrendGranularity = "day" | "week" | "month";
export type ProductSortKey = "reviews" | "rating" | "published" | "pending";

export type AnalyticsRange = {
  key: AnalyticsRangeKey;
  from: Date | null;
  to: Date;
  label: string;
  fromInput: string;
  toInput: string;
};

export type TrendPoint = { label: string; count: number };
export type RatingRow = { rating: number; count: number; percent: string };
export type ProductPerformance = {
  productId: string;
  productTitle: string;
  reviewCount: number;
  averageRating: number | null;
  published: number;
  pending: number;
};
export type ActivityItem = {
  id: string;
  type: string;
  label: string;
  detail: string;
  at: string;
};

export type AnalyticsData = {
  shop: string;
  shopName: string;
  range: AnalyticsRange;
  granularity: TrendGranularity;
  sort: ProductSortKey;
  direction: "asc" | "desc";
  overview: {
    totalReviews: number;
    published: number;
    pending: number;
    rejected: number;
    averageRating: number | null;
    reviewRequests: number;
    sentRequests: number;
    completedRequests: number;
    completionRate: string;
  };
  trend: TrendPoint[];
  ratings: RatingRow[];
  funnel: {
    created: number;
    sent: number;
    completed: number;
    sentRate: string;
    completedRate: string;
  };
  products: ProductPerformance[];
  topRated: ProductPerformance[];
  lowestRated: ProductPerformance[];
  activity: ActivityItem[];
  loadError: string | null;
};

type CountRow = { bucket: string; count: bigint | number };

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function formatInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseInputDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function percent(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export function resolveAnalyticsRange(url: URL, now = new Date()): AnalyticsRange {
  const requested = url.searchParams.get("range") ?? "30";
  const key: AnalyticsRangeKey =
    requested === "7" ||
    requested === "30" ||
    requested === "90" ||
    requested === "365" ||
    requested === "all" ||
    requested === "custom"
      ? requested
      : "30";
  const to = endOfDay(now);

  if (key === "all") {
    return {
      key,
      from: null,
      to,
      label: "All time",
      fromInput: "",
      toInput: formatInputDate(now),
    };
  }

  if (key === "custom") {
    const fromDate = parseInputDate(url.searchParams.get("from"));
    const toDate = parseInputDate(url.searchParams.get("to"));
    if (fromDate && toDate && fromDate.getTime() <= toDate.getTime()) {
      return {
        key,
        from: startOfDay(fromDate),
        to: endOfDay(toDate),
        label: `${formatInputDate(fromDate)} to ${formatInputDate(toDate)}`,
        fromInput: formatInputDate(fromDate),
        toInput: formatInputDate(toDate),
      };
    }
  }

  const days = key === "custom" ? 30 : Number(key);
  const from = startOfDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  return {
    key: key === "custom" ? "30" : key,
    from,
    to,
    label: `Last ${days} days`,
    fromInput: formatInputDate(from),
    toInput: formatInputDate(now),
  };
}

export function resolveGranularity(range: AnalyticsRange): TrendGranularity {
  if (!range.from) return "month";
  const days = (range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

function reviewWhere(
  shop: string,
  range: AnalyticsRange,
): Prisma.ReviewWhereInput {
  return {
    shop,
    ...(range.from
      ? { createdAt: { gte: range.from, lte: range.to } }
      : { createdAt: { lte: range.to } }),
  };
}

function requestWhere(
  shop: string,
  range: AnalyticsRange,
): Prisma.ReviewRequestWhereInput {
  return {
    shop,
    ...(range.from
      ? { createdAt: { gte: range.from, lte: range.to } }
      : { createdAt: { lte: range.to } }),
  };
}

function bucketSql(granularity: TrendGranularity): string {
  if (granularity === "week") return "strftime('%Y-W%W', createdAt)";
  if (granularity === "month") return "strftime('%Y-%m', createdAt)";
  return "strftime('%Y-%m-%d', createdAt)";
}

async function loadTrend(
  shop: string,
  range: AnalyticsRange,
  granularity: TrendGranularity,
): Promise<TrendPoint[]> {
  const dateSql =
    range.from === null
      ? Prisma.empty
      : Prisma.sql`AND createdAt >= ${range.from} AND createdAt <= ${range.to}`;
  const allTimeSql =
    range.from === null ? Prisma.sql`AND createdAt <= ${range.to}` : Prisma.empty;
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT ${Prisma.raw(bucketSql(granularity))} AS bucket, COUNT(*) AS count
    FROM "Review"
    WHERE shop = ${shop}
    ${dateSql}
    ${allTimeSql}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const counts = new Map(
    rows.map((row) => [row.bucket, Number(row.count)]),
  );
  if ([...counts.values()].every((count) => count === 0) || counts.size === 0) {
    return [];
  }

  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

function sortProducts(
  products: ProductPerformance[],
  sort: ProductSortKey,
  direction: "asc" | "desc",
): ProductPerformance[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...products].sort((left, right) => {
    const leftValue =
      sort === "rating"
        ? (left.averageRating ?? -1)
        : sort === "published"
          ? left.published
          : sort === "pending"
            ? left.pending
            : left.reviewCount;
    const rightValue =
      sort === "rating"
        ? (right.averageRating ?? -1)
        : sort === "published"
          ? right.published
          : sort === "pending"
            ? right.pending
            : right.reviewCount;
    if (leftValue === rightValue) return right.reviewCount - left.reviewCount;
    return (leftValue - rightValue) * factor;
  });
}

function csvCell(value: string | number | null | undefined): string {
  return escapeCsvCell(value);
}

export function reviewsToCsv(
  rows: {
    productTitle: string | null;
    customerName: string | null;
    rating: number;
    status: string;
    createdAt: Date;
  }[],
): string {
  const header = ["Product", "Customer", "Rating", "Status", "Date"];
  const lines = rows.map((row) =>
    [
      row.productTitle?.trim() || "",
      row.customerName?.trim() || "Anonymous",
      row.rating,
      row.status,
      row.createdAt.toISOString(),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function requestsToCsv(
  rows: {
    customerName: string | null;
    productTitle: string | null;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }[],
): string {
  const header = ["Customer", "Product", "Status", "Created", "Completed"];
  const lines = rows.map((row) =>
    [
      row.customerName?.trim() || "",
      row.productTitle?.trim() || "",
      row.status,
      row.createdAt.toISOString(),
      row.completedAt ? row.completedAt.toISOString() : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function pdfEscape(value: string): string {
  const ascii = Array.from(value)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126 ? char : "?";
    })
    .join("");
  return ascii.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function buildAnalyticsPdf(lines: string[]): Uint8Array {
  const pageSize = 46;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageSize) {
    pages.push(lines.slice(index, index + pageSize));
  }
  if (pages.length === 0) pages.push(["RG Review analytics"]);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  let nextId = 3;

  const fontId = 3;
  objects.push("3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");
  nextId = 4;

  const contentIds: number[] = [];
  for (const pageLines of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    contentIds.push(contentId);
    pageObjectIds.push(pageId);
    const commands = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL"];
    pageLines.forEach((line, lineIndex) => {
      const text = pdfEscape(line.slice(0, 110));
      if (lineIndex === 0) commands.push(`(${text}) Tj`);
      else commands.push(`T* (${text}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.push(
      `${contentId} 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj`,
    );
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj`,
    );
  }

  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  const catalog = "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj";
  const pageTree = `2 0 obj << /Type /Pages /Count ${pageObjectIds.length} /Kids [${kids}] >> endobj`;
  let offset = 0;
  const xref: number[] = [0];
  const chunks = [`%PDF-1.4\n`];
  offset = Buffer.byteLength(chunks[0], "utf8");
  for (const object of [catalog, pageTree, ...objects]) {
    xref.push(offset);
    const piece = `${object}\n`;
    chunks.push(piece);
    offset += Buffer.byteLength(piece, "utf8");
  }
  const xrefStart = offset;
  let xrefTable = `xref\n0 ${xref.length}\n0000000000 65535 f \n`;
  for (const position of xref.slice(1)) {
    xrefTable += `${String(position).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(`${chunks.join("")}${xrefTable}${trailer}`);
}

export function analyticsPdfLines(data: AnalyticsData): string[] {
  const average =
    data.overview.averageRating === null
      ? "—"
      : data.overview.averageRating.toFixed(1);
  const lines = [
    "RG Review",
    "Analytics report",
    `Store: ${data.shopName}`,
    `Range: ${data.range.label}`,
    "",
    "Summary",
    `Total reviews: ${data.overview.totalReviews}`,
    `Published: ${data.overview.published}`,
    `Pending: ${data.overview.pending}`,
    `Rejected: ${data.overview.rejected}`,
    `Average rating: ${average}`,
    `Review requests: ${data.overview.reviewRequests}`,
    `Sent requests: ${data.overview.sentRequests}`,
    `Completed requests: ${data.overview.completedRequests}`,
    `Completion rate: ${data.overview.completionRate}`,
    "",
    "Rating distribution",
  ];

  if (data.overview.totalReviews === 0) {
    lines.push("No reviews in this range.");
  } else {
    for (const row of data.ratings) {
      lines.push(`${row.rating} star: ${row.count} (${row.percent})`);
    }
  }

  lines.push("", "Request funnel", `Created: ${data.funnel.created}`);
  lines.push(`Sent: ${data.funnel.sent} (${data.funnel.sentRate} of created)`);
  lines.push(
    `Completed: ${data.funnel.completed} (${data.funnel.completedRate} of sent)`,
  );
  lines.push("", "Product performance");

  if (data.products.length === 0) {
    lines.push("No product reviews in this range.");
  } else {
    for (const product of data.products.slice(0, 20)) {
      const rating =
        product.averageRating === null ? "—" : product.averageRating.toFixed(1);
      lines.push(
        `${product.productTitle} | reviews ${product.reviewCount} | avg ${rating} | published ${product.published} | pending ${product.pending}`,
      );
    }
  }

  return lines;
}

export async function loadAnalytics(input: {
  shop: string;
  shopName: string;
  range: AnalyticsRange;
  sort: ProductSortKey;
  direction: "asc" | "desc";
}): Promise<AnalyticsData> {
  const { shop, range, sort, direction } = input;
  const reviewsWhere = reviewWhere(shop, range);
  const requestsWhere = requestWhere(shop, range);
  const granularity = resolveGranularity(range);

  const [
    totalReviews,
    published,
    pending,
    rejected,
    average,
    reviewRequests,
    sentRequests,
    completedRequests,
    ratingGroups,
    productStatusGroups,
    productTitles,
    trend,
    submittedReviews,
    changedReviews,
    createdRequests,
    completedRequestRows,
  ] = await Promise.all([
    prisma.review.count({ where: reviewsWhere }),
    prisma.review.count({ where: { ...reviewsWhere, status: "published" } }),
    prisma.review.count({ where: { ...reviewsWhere, status: "pending" } }),
    prisma.review.count({ where: { ...reviewsWhere, status: "rejected" } }),
    prisma.review.aggregate({ where: reviewsWhere, _avg: { rating: true } }),
    prisma.reviewRequest.count({ where: requestsWhere }),
    prisma.reviewRequest.count({
      where: { ...requestsWhere, sentAt: { not: null } },
    }),
    prisma.reviewRequest.count({
      where: { ...requestsWhere, status: "completed" },
    }),
    prisma.review.groupBy({
      by: ["rating"],
      where: reviewsWhere,
      _count: { _all: true },
    }),
    prisma.review.groupBy({
      by: ["productId", "status"],
      where: reviewsWhere,
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.review.groupBy({
      by: ["productId", "productTitle"],
      where: reviewsWhere,
      _max: { createdAt: true },
    }),
    loadTrend(shop, range, granularity),
    prisma.review.findMany({
      where: reviewsWhere,
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        productTitle: true,
        customerName: true,
        createdAt: true,
      },
    }),
    prisma.review.findMany({
      where: {
        shop,
        status: { in: ["published", "rejected"] },
        updatedAt: range.from
          ? { gte: range.from, lte: range.to }
          : { lte: range.to },
      },
      orderBy: { updatedAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        status: true,
        productTitle: true,
        updatedAt: true,
      },
    }),
    prisma.reviewRequest.findMany({
      where: requestsWhere,
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, productTitle: true, createdAt: true },
    }),
    prisma.reviewRequest.findMany({
      where: {
        ...requestsWhere,
        status: "completed",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, productTitle: true, completedAt: true },
    }),
  ]);

  const ratingCounts = new Map(
    ratingGroups.map((row) => [row.rating, row._count._all]),
  );
  const ratings = [5, 4, 3, 2, 1].map((rating) => {
    const count = ratingCounts.get(rating) ?? 0;
    return {
      rating,
      count,
      percent: percent(count, totalReviews),
    };
  });

  const titleByProduct = new Map<string, { title: string; at: number }>();
  for (const row of productTitles) {
    if (!row.productId) continue;
    const at = row._max.createdAt?.getTime() ?? 0;
    const current = titleByProduct.get(row.productId);
    if (!current || at >= current.at) {
      titleByProduct.set(row.productId, {
        title: row.productTitle?.trim() || "Untitled product",
        at,
      });
    }
  }

  const productMap = new Map<string, ProductPerformance>();
  for (const row of productStatusGroups) {
    const productId = row.productId || "unassigned";
    const current = productMap.get(productId) ?? {
      productId,
      productTitle: titleByProduct.get(productId)?.title || "Untitled product",
      reviewCount: 0,
      averageRating: null,
      published: 0,
      pending: 0,
    };
    current.reviewCount += row._count._all;
    if (row.status === "published") current.published += row._count._all;
    if (row.status === "pending") current.pending += row._count._all;
    productMap.set(productId, current);
  }

  const ratingByProduct = new Map<string, { total: number; count: number }>();
  for (const row of productStatusGroups) {
    const productId = row.productId || "unassigned";
    const current = ratingByProduct.get(productId) ?? { total: 0, count: 0 };
    current.total += (row._avg.rating ?? 0) * row._count._all;
    current.count += row._count._all;
    ratingByProduct.set(productId, current);
  }
  for (const [productId, product] of productMap) {
    const rating = ratingByProduct.get(productId);
    product.averageRating =
      rating && rating.count > 0 ? rating.total / rating.count : null;
  }

  const products = sortProducts([...productMap.values()], sort, direction);
  const qualified = products.filter(
    (product) => product.reviewCount >= MIN_REVIEWS_FOR_RANKING,
  );
  const topRated = [...qualified]
    .sort(
      (left, right) =>
        (right.averageRating ?? 0) - (left.averageRating ?? 0) ||
        right.reviewCount - left.reviewCount,
    )
    .slice(0, 5);
  const lowestRated =
    qualified.length < 2
      ? []
      : [...qualified]
          .sort(
            (left, right) =>
              (left.averageRating ?? 0) - (right.averageRating ?? 0) ||
              right.reviewCount - left.reviewCount,
          )
          .slice(0, 5);

  const activity: ActivityItem[] = [
    ...submittedReviews.map((review) => ({
      id: `submitted-${review.id}`,
      type: "Review submitted",
      label: review.productTitle?.trim() || "Product",
      detail: review.customerName?.trim() || "Anonymous",
      at: review.createdAt.toISOString(),
    })),
    ...changedReviews.map((review) => ({
      id: `${review.status}-${review.id}`,
      type: review.status === "published" ? "Review published" : "Review rejected",
      label: review.productTitle?.trim() || "Product",
      detail: review.status,
      at: review.updatedAt.toISOString(),
    })),
    ...createdRequests.map((request) => ({
      id: `request-${request.id}`,
      type: "Review request created",
      label: request.productTitle?.trim() || "Product",
      detail: "Request created",
      at: request.createdAt.toISOString(),
    })),
    ...completedRequestRows.flatMap((request) =>
      request.completedAt
        ? [
            {
              id: `completed-${request.id}`,
              type: "Review request completed",
              label: request.productTitle?.trim() || "Product",
              detail: "Request completed",
              at: request.completedAt.toISOString(),
            },
          ]
        : [],
    ),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, ACTIVITY_LIMIT);

  return {
    shop,
    shopName: input.shopName,
    range,
    granularity,
    sort,
    direction,
    overview: {
      totalReviews,
      published,
      pending,
      rejected,
      averageRating: average._avg.rating,
      reviewRequests,
      sentRequests,
      completedRequests,
      completionRate: percent(completedRequests, sentRequests),
    },
    trend: totalReviews === 0 ? [] : trend,
    ratings: totalReviews === 0 ? [] : ratings,
    funnel: {
      created: reviewRequests,
      sent: sentRequests,
      completed: completedRequests,
      sentRate: percent(sentRequests, reviewRequests),
      completedRate: percent(completedRequests, sentRequests),
    },
    products,
    topRated,
    lowestRated,
    activity,
    loadError: null,
  };
}

export async function loadReviewExport(shop: string, range: AnalyticsRange) {
  return prisma.review.findMany({
    where: reviewWhere(shop, range),
    orderBy: { createdAt: "desc" },
    select: {
      productTitle: true,
      customerName: true,
      rating: true,
      status: true,
      createdAt: true,
    },
  });
}

export async function loadRequestExport(shop: string, range: AnalyticsRange) {
  return prisma.reviewRequest.findMany({
    where: requestWhere(shop, range),
    orderBy: { createdAt: "desc" },
    select: {
      customerName: true,
      productTitle: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });
}

export function fileResponse(
  body: string | Uint8Array,
  type: string,
  filename: string,
) {
  const payload = typeof body === "string" ? body : Buffer.from(body);
  return new Response(payload, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
