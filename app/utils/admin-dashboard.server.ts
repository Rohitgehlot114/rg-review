import prisma from "../db.server";

export type DashboardStatus = "published" | "pending" | "rejected";

export type DashboardProduct = {
  productId: string;
  title: string;
  total: number;
  published: number;
  pending: number;
  verified: number;
  averageRating: number | null;
};

export type DashboardReview = {
  id: string;
  customerName: string | null;
  productTitle: string | null;
  rating: number;
  body: string;
  status: string;
  createdAt: string;
};

export type DashboardData = {
  total: number;
  published: number;
  pending: number;
  rejected: number;
  verified: number;
  averageRating: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  activity: Array<{ day: string; count: number }>;
  products: DashboardProduct[];
  recent: DashboardReview[];
  requests: {
    pending: number;
    sent: number;
    completed: number;
    cancelled: number;
    expired: number;
  };
};

function emptyDistribution(): DashboardData["distribution"] {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lastDays(count: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_item, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (count - 1 - index));
    return dayKey(date);
  });
}

export async function loadAdminDashboard(shop: string): Promise<DashboardData> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 29);

  const [counts, publishedGroups, verified, activityRows, productGroups, recent, requestGroups] =
    await Promise.all([
      prisma.review.groupBy({
        by: ["status"],
        where: { shop },
        _count: { _all: true },
      }),
      prisma.review.groupBy({
        by: ["rating"],
        where: { shop, status: "published" },
        _count: { _all: true },
      }),
      prisma.review.count({
        where: { shop, status: "published", verifiedPurchase: true },
      }),
      prisma.review.findMany({
        where: { shop, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.review.groupBy({
        by: ["productId", "productTitle", "status", "rating", "verifiedPurchase"],
        where: { shop },
        _count: { _all: true },
      }),
      prisma.review.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          customerName: true,
          productTitle: true,
          rating: true,
          body: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.reviewRequest.groupBy({
        by: ["status"],
        where: { shop },
        _count: { _all: true },
      }),
    ]);

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
  const published = byStatus.get("published") ?? 0;
  const pending = byStatus.get("pending") ?? 0;
  const rejected = byStatus.get("rejected") ?? 0;
  const total = [...byStatus.values()].reduce((sum, count) => sum + count, 0);
  const distribution = emptyDistribution();
  let ratingTotal = 0;
  for (const row of publishedGroups) {
    if (row.rating < 1 || row.rating > 5) continue;
    distribution[row.rating as 1 | 2 | 3 | 4 | 5] = row._count._all;
    ratingTotal += row.rating * row._count._all;
  }

  const activityCounts = new Map<string, number>();
  for (const row of activityRows) {
    const key = dayKey(row.createdAt);
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
  }

  const products = new Map<string, DashboardProduct & { ratingTotal: number; ratingCount: number }>();
  for (const row of productGroups) {
    const key = row.productId || row.productTitle || "store";
    const current = products.get(key) ?? {
      productId: key,
      title: row.productTitle || "Product",
      total: 0,
      published: 0,
      pending: 0,
      verified: 0,
      averageRating: null,
      ratingTotal: 0,
      ratingCount: 0,
    };
    current.total += row._count._all;
    if (row.status === "published") {
      current.published += row._count._all;
      current.ratingTotal += row.rating * row._count._all;
      current.ratingCount += row._count._all;
      if (row.verifiedPurchase) current.verified += row._count._all;
    }
    if (row.status === "pending") current.pending += row._count._all;
    if (!current.title && row.productTitle) current.title = row.productTitle;
    products.set(key, current);
  }

  const requests = { pending: 0, sent: 0, completed: 0, cancelled: 0, expired: 0 };
  for (const row of requestGroups) {
    if (row.status in requests) {
      requests[row.status as keyof typeof requests] = row._count._all;
    }
  }

  return {
    total,
    published,
    pending,
    rejected,
    verified,
    averageRating: published ? Math.round((ratingTotal / published) * 10) / 10 : null,
    distribution,
    activity: lastDays(30).map((day) => ({ day, count: activityCounts.get(day) ?? 0 })),
    products: [...products.values()]
      .map((product) => ({
        productId: product.productId,
        title: product.title,
        total: product.total,
        published: product.published,
        pending: product.pending,
        verified: product.verified,
        averageRating: product.ratingCount
          ? Math.round((product.ratingTotal / product.ratingCount) * 10) / 10
          : null,
      }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 8),
    recent: recent.map((review) => ({
      ...review,
      createdAt: review.createdAt.toISOString(),
    })),
    requests,
  };
}
