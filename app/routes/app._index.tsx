import type { ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  AdminLink,
  AdminShell,
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  RatingStars,
} from "../components/admin/ui";
import { authenticate } from "../shopify.server";
import {
  loadAdminDashboard,
  type DashboardData,
} from "../utils/admin-dashboard.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const loadedAt = new Date().toISOString();
  try {
    const dashboard = await loadAdminDashboard(session.shop);
    return {
      shop: session.shop,
      apiKey: process.env.SHOPIFY_API_KEY || "",
      dashboard,
      loadedAt,
      loadError: null as string | null,
    };
  } catch {
    return {
      shop: session.shop,
      apiKey: process.env.SHOPIFY_API_KEY || "",
      dashboard: null as DashboardData | null,
      loadedAt,
      loadError: "Some dashboard data could not be loaded.",
    };
  }
};

export default function Dashboard() {
  const { shop, apiKey, dashboard, loadedAt, loadError } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const store = shop.replace(/\.myshopify\.com$/i, "");
  const editor = `https://admin.shopify.com/store/${encodeURIComponent(store)}/themes/current/editor`;
  const reviewsBlock = apiKey
    ? `${editor}?template=product&addAppBlockId=${encodeURIComponent(`${apiKey}/reviews-display`)}&target=newAppsSection`
    : "";
  const reviewsEmbed = apiKey
    ? `${editor}?context=apps&activateAppId=${encodeURIComponent(`${apiKey}/review-form`)}`
    : "";

  return (
    <AdminShell
      title="Dashboard"
      subtitle="Monitor customer feedback, ratings, and review performance."
      actions={
        <>
          <Button variant="secondary" onClick={() => revalidator.revalidate()} disabled={revalidator.state === "loading"}>
            Refresh
          </Button>
          <Button href="/app/settings" variant="secondary">Settings</Button>
        </>
      }
    >
      <p className="text-xs text-[#6d7175]">Updated {new Date(loadedAt).toLocaleString()}</p>
      {loadError ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#e3e3e3] bg-white p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm font-semibold">{loadError}</p>
          <Button href="/app" variant="secondary">Retry</Button>
        </div>
      ) : null}
      {dashboard ? <DashboardBody data={dashboard} /> : null}
      <section className="rounded-xl border border-[#e3e3e3] bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Add reviews to your theme</h2>
        <p className="mt-2 text-sm text-[#6d7175]">
          Product reviews appear after the Product reviews block is added to the product template.
        </p>
        <h3 className="mt-4 text-sm font-semibold">Product page reviews</h3>
        <ol className="mt-2 grid list-decimal gap-2 pl-5 text-sm text-[#3d4246]">
          <li>Open Online Store, then Themes, then Customize.</li>
          <li>Open the product template.</li>
          <li>Choose Add block, then Apps, then Product reviews.</li>
          <li>Save the theme.</li>
        </ol>
        {reviewsBlock ? (
          <a className="mt-3 inline-flex text-sm font-semibold text-[#005bd3]" href={reviewsBlock} target="_top">
            Add the Product reviews block
          </a>
        ) : null}
        <h3 className="mt-4 text-sm font-semibold">Floating Reviews button</h3>
        <ol className="mt-2 grid list-decimal gap-2 pl-5 text-sm text-[#3d4246]">
          <li>In the theme editor, open App embeds.</li>
          <li>Enable Product Reviews.</li>
          <li>Save the theme.</li>
        </ol>
        {reviewsEmbed ? (
          <a className="mt-3 inline-flex text-sm font-semibold text-[#005bd3]" href={reviewsEmbed} target="_top">
            Open App embeds
          </a>
        ) : null}
      </section>
    </AdminShell>
  );
}

function DashboardBody({ data }: { data: DashboardData }) {
  const sentBase = data.requests.sent + data.requests.completed;
  return (
    <>
      {data.total === 0 ? (
        <EmptyState title="No reviews yet" action={<Button href="/app/reviews">Manage reviews</Button>}>
          Once customers submit reviews, your review analytics will appear here.
        </EmptyState>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Total reviews">
          <p className="text-3xl font-semibold">{data.total}</p>
          <p className="mt-2 text-sm text-[#6d7175]">
            {data.published} published · {data.pending} pending · {data.rejected} rejected
          </p>
        </Kpi>
        <Kpi title="Average rating">
          <div className="flex items-end gap-2">
            <p className="text-3xl font-semibold">{formatAverage(data.averageRating)}</p>
            <RatingStars rating={data.averageRating ?? 0} label={ratingLabel(data.averageRating, data.published)} />
          </div>
          <p className="mt-2 text-sm text-[#6d7175]">
            {data.published} published {data.published === 1 ? "review" : "reviews"}
          </p>
        </Kpi>
        <Kpi title="Published reviews">
          <p className="text-3xl font-semibold">{data.published}</p>
          <p className="mt-2 text-sm text-[#6d7175]">
            {data.total === 0 ? "No reviews yet" : `${share(data.published, data.total)} of all reviews`}
          </p>
        </Kpi>
        <Kpi title="Verified purchases">
          <p className="text-3xl font-semibold">{data.verified}</p>
          <p className="mt-2 text-sm text-[#6d7175]">
            {data.published === 0 ? "No verified purchases yet" : `${share(data.verified, data.published)} of published reviews`}
          </p>
        </Kpi>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="Rating distribution" className="xl:col-span-3">
          {data.published > 0 ? (
            <div className="grid gap-3">
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const count = data.distribution[star];
                const width = (count / data.published) * 100;
                return (
                  <div key={star} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-sm font-semibold">
                      {star}
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#F5B301" />
                      </svg>
                    </span>
                    <ProgressBar value={width} label={`${star} star reviews, ${count}`} />
                    <span className="text-sm tabular-nums text-[#6d7175]">{count} · {share(count, data.published)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[#6d7175]">No published reviews yet.</p>
          )}
        </Card>
        <Card title="Review status" className="xl:col-span-2">
          <div className="grid gap-3">
            <StatusRow label="Published" count={data.published} tone="success" />
            <StatusRow label="Pending" count={data.pending} tone="warning" />
            <StatusRow label="Rejected" count={data.rejected} tone="critical" />
          </div>
        </Card>
      </div>

      <Card title="Review activity">
        {data.activity.some((point) => point.count > 0) ? (
          <ActivityChart points={data.activity} />
        ) : (
          <p className="text-sm text-[#6d7175]">Not enough review data yet</p>
        )}
      </Card>

      <Card title="Product performance">
        {data.products.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[#6d7175]">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Product</th>
                  <th className="py-2 pr-3 font-semibold">Rating</th>
                  <th className="py-2 pr-3 font-semibold">Reviews</th>
                  <th className="py-2 pr-3 font-semibold">Verified</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => (
                  <tr key={product.productId} className="border-t border-[#f1f2f3]">
                    <td className="py-3 pr-3 font-semibold">{product.title}</td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <RatingStars rating={product.averageRating ?? 0} label={ratingLabel(product.averageRating, product.published)} />
                        <span>{formatAverage(product.averageRating)}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-3">{product.total}</td>
                    <td className="py-3 pr-3">{product.verified}</td>
                    <td className="py-3 pr-3">
                      <Badge tone={product.pending > 0 ? "warning" : product.published > 0 ? "success" : "neutral"}>
                        {product.pending > 0 ? "Pending reviews" : product.published > 0 ? "Published" : "No public reviews"}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <AdminLink className="font-semibold text-[#008060]" href={`/app/reviews?q=${encodeURIComponent(product.title)}`}>
                        View reviews
                      </AdminLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[#6d7175]">No product ratings yet.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Recent reviews" action={<AdminLink className="text-sm font-semibold text-[#008060]" href="/app/reviews">Manage reviews</AdminLink>}>
          {data.recent.length > 0 ? (
            <ul className="grid gap-3">
              {data.recent.map((review) => (
                <li key={review.id}>
                  <AdminLink className="grid grid-cols-[auto_1fr] gap-3 rounded-lg p-1 hover:bg-[#f6f6f7]" href={`/app/reviews?review=${encodeURIComponent(review.id)}`}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f1f2f3] text-xs font-semibold" aria-hidden="true">
                      {initials(review.customerName)}
                    </span>
                    <span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{review.customerName || "Customer"}</span>
                        <RatingStars rating={review.rating} size={14} label={`${review.rating} out of 5 stars`} />
                        <Badge tone={review.status === "pending" ? "warning" : review.status === "rejected" ? "critical" : "success"}>
                          {labelFor(review.status)}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-sm text-[#6d7175]">
                        {review.productTitle || "Product"} · {new Date(review.createdAt).toLocaleDateString()}
                      </span>
                      <span className="mt-1 block text-sm">{review.body.slice(0, 140)}</span>
                    </span>
                  </AdminLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#6d7175]">No reviews yet.</p>
          )}
        </Card>
        <div className="grid gap-4">
          <Card title="Review requests" action={<AdminLink className="text-sm font-semibold text-[#008060]" href="/app/review-requests">Manage review requests</AdminLink>}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Requests sent" value={data.requests.sent} />
              <Metric label="Requests pending" value={data.requests.pending} />
              <Metric label="Completed" value={data.requests.completed} />
              <Metric label="Expired" value={data.requests.expired} />
              <div className="col-span-2">
                <dt className="text-[#6d7175]">Conversion rate</dt>
                <dd className="text-lg font-semibold">
                  {sentBase === 0 ? "Conversion data will appear after review requests are sent." : share(data.requests.completed, sentBase)}
                </dd>
              </div>
            </dl>
          </Card>
          <Card title="Storefront reviews">
            <p className="text-sm">Customers can submit reviews directly from product pages. New reviews are published immediately.</p>
          </Card>
        </div>
      </div>

      <Card title="Quick actions">
        <div className="flex flex-wrap gap-2">
          <Button href="/app/reviews">Manage reviews</Button>
          <Button href="/app/review-requests" variant="secondary">Review requests</Button>
          <Button href="/app/settings" variant="secondary">Settings</Button>
        </div>
      </Card>
    </>
  );
}

function Kpi({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e3e3e3] bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <h2 className="text-sm font-semibold text-[#6d7175]">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function StatusRow({ label, count, tone }: { label: string; count: number; tone: "success" | "warning" | "critical" }) {
  const mark = tone === "success" ? "bg-[#008060]" : tone === "warning" ? "bg-[#b98900]" : "bg-[#d72c0d]";
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#f1f2f3] px-3 py-2">
      <span className="inline-flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2.5 w-2.5 rounded-full ${mark}`} aria-hidden="true" />
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums">{count}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[#6d7175]">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function ActivityChart({ points }: { points: Array<{ day: string; count: number }> }) {
  const max = Math.max(...points.map((point) => point.count), 1);
  const width = 640;
  const height = 160;
  const gap = 8;
  const barWidth = Math.max(8, (width - gap * (points.length - 1)) / points.length);
  return (
    <svg viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label="Reviews submitted over the last 30 days" className="h-auto w-full">
      {points.map((point, index) => {
        const barHeight = point.count === 0 ? 2 : Math.max(4, (point.count / max) * height);
        const x = index * (barWidth + gap);
        return (
          <g key={point.day}>
            <rect x={x} y={height - barHeight} width={barWidth} height={barHeight} rx="4" fill="#008060">
              <title>{`${point.day}: ${point.count} reviews`}</title>
            </rect>
            {index % 5 === 0 ? (
              <text x={x + barWidth / 2} y={height + 16} textAnchor="middle" fontSize="10" fill="#6d7175">
                {point.day.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function formatAverage(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}

function share(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function ratingLabel(average: number | null, count: number) {
  if (!count || average == null) return "No rating yet";
  return `Rated ${average.toFixed(1)} out of 5 from ${count} published reviews`;
}

function labelFor(status: string) {
  if (status === "published") return "Published";
  if (status === "pending") return "Pending";
  if (status === "rejected") return "Rejected";
  return status;
}

function initials(name: string | null) {
  const parts = (name || "Customer").trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "C";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
