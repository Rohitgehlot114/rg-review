import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shop: string | null = null;
  try {
    const context = await authenticate.public.appProxy(request);
    shop = context.session?.shop ?? null;
  } catch {
    shop = null;
  }
  if (!shop) {
    return Response.json(
      { success: false, error: { code: "INVALID_SIGNATURE", message: "Request signature is invalid" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const ids = [
    ...new Set(
      (new URL(request.url).searchParams.get("productIds") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d{1,20}$/.test(value)),
    ),
  ].slice(0, 50);
  const ratings: Record<string, { averageRating: number | null; reviewCount: number }> =
    {};
  for (const id of ids) ratings[id] = { averageRating: null, reviewCount: 0 };
  if (ids.length === 0) {
    return Response.json(
      { success: true, data: { ratings } },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  }

  const groups = await prisma.review.groupBy({
    by: ["productId", "rating"],
    where: {
      shop,
      status: "published",
      productId: {
        in: ids.flatMap((id) => [`gid://shopify/Product/${id}`, id]),
      },
    },
    _count: { _all: true },
  });

  const totals = new Map<string, { count: number; rating: number }>();
  for (const group of groups) {
    const numeric = group.productId?.match(/(\d+)$/)?.[1];
    if (!numeric || !ratings[numeric]) continue;
    const current = totals.get(numeric) ?? { count: 0, rating: 0 };
    current.count += group._count._all;
    current.rating += group.rating * group._count._all;
    totals.set(numeric, current);
  }
  for (const [id, total] of totals) {
    ratings[id] = {
      reviewCount: total.count,
      averageRating: total.count
        ? Math.round((total.rating / total.count) * 10) / 10
        : null,
    };
  }

  return Response.json(
    { success: true, data: { ratings } },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
};
