import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { formatAverageRating, formatDateTime } from "../utils/reviews";
import type { AnalyticsData, ProductSortKey } from "../utils/analytics.server";

const MIN_REVIEWS_FOR_RANKING = 2;
const SORTS: ProductSortKey[] = ["reviews", "rating", "published", "pending"];

function parseSort(value: string | null): ProductSortKey {
  return SORTS.includes(value as ProductSortKey)
    ? (value as ProductSortKey)
    : "reviews";
}

async function loadShopName(admin: {
  graphql: (query: string) => Promise<Response>;
}): Promise<string | null> {
  const response = await admin.graphql(`#graphql
    query AnalyticsShopName {
      shop {
        name
      }
    }`);
  const payload = await response.json();
  const name = payload?.data?.shop?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const {
    analyticsPdfLines,
    buildAnalyticsPdf,
    fileResponse,
    loadAnalytics,
    loadRequestExport,
    loadReviewExport,
    requestsToCsv,
    resolveAnalyticsRange,
    reviewsToCsv,
  } = await import("../utils/analytics.server");
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = resolveAnalyticsRange(url);
  const sort = parseSort(url.searchParams.get("sort"));
  const direction = url.searchParams.get("direction") === "asc" ? "asc" : "desc";
  const format = url.searchParams.get("format");
  const shopName = session.shop;

  try {
    if (format === "csv") {
      const dataset = url.searchParams.get("dataset");
      if (dataset === "requests") {
        const rows = await loadRequestExport(session.shop, range);
        throw fileResponse(
          requestsToCsv(rows),
          "text/csv; charset=utf-8",
          "rg-review-requests.csv",
        );
      }
      const rows = await loadReviewExport(session.shop, range);
      throw fileResponse(
        reviewsToCsv(rows),
        "text/csv; charset=utf-8",
        "rg-review-reviews.csv",
      );
    }

    if (format === "pdf") {
      const resolvedName = (await loadShopName(admin).catch(() => null)) || shopName;
      const data = await loadAnalytics({
        shop: session.shop,
        shopName: resolvedName,
        range,
        sort,
        direction,
      });
      throw fileResponse(
        buildAnalyticsPdf(analyticsPdfLines(data)),
        "application/pdf",
        "rg-review-analytics.pdf",
      );
    }

    const resolvedName = (await loadShopName(admin).catch(() => null)) || shopName;
    return await loadAnalytics({
      shop: session.shop,
      shopName: resolvedName,
      range,
      sort,
      direction,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return {
      shop: session.shop,
      shopName,
      range,
      granularity: "day" as const,
      sort,
      direction,
      overview: {
        totalReviews: 0,
        published: 0,
        pending: 0,
        rejected: 0,
        averageRating: null,
        reviewRequests: 0,
        sentRequests: 0,
        completedRequests: 0,
        completionRate: "—",
      },
      trend: [],
      ratings: [],
      funnel: {
        created: 0,
        sent: 0,
        completed: 0,
        sentRate: "—",
        completedRate: "—",
      },
      products: [],
      topRated: [],
      lowestRated: [],
      activity: [],
      loadError: "Unable to load analytics right now.",
    } satisfies AnalyticsData;
  }
};

function queryString(data: AnalyticsData, updates: Record<string, string | null>) {
  const params = new URLSearchParams();
  params.set("range", data.range.key);
  if (data.range.key === "custom") {
    if (data.range.fromInput) params.set("from", data.range.fromInput);
    if (data.range.toInput) params.set("to", data.range.toInput);
  }
  params.set("sort", data.sort);
  params.set("direction", data.direction);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `/app/analytics?${params.toString()}`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
      minInlineSize="140px"
    >
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  if (data.loadError) {
    return (
      <s-page heading="Analytics">
        <s-banner tone="critical" heading="Could not load analytics">
          <s-paragraph>{data.loadError}</s-paragraph>
        </s-banner>
      </s-page>
    );
  }
  const maxTrend = Math.max(1, ...data.trend.map((point) => point.count));

  return (
    <s-page heading="Analytics">
      <s-button slot="primary-action" href={queryString(data, { format: "pdf" })}>
        Export PDF
      </s-button>
      <s-button slot="secondary-actions" href={queryString(data, { format: "csv", dataset: "reviews" })}>
        Export reviews CSV
      </s-button>
      <s-button slot="secondary-actions" href={queryString(data, { format: "csv", dataset: "requests" })}>
        Export requests CSV
      </s-button>

      <s-section>
        <s-paragraph>
          Performance for {data.shopName}. Figures use reviews and review
          requests stored for this store during {data.range.label.toLowerCase()}.
        </s-paragraph>
      </s-section>

      <s-section heading="Date range">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-select name="range" label="Range" value={data.range.key}>
              <s-option value="7">Last 7 days</s-option>
              <s-option value="30">Last 30 days</s-option>
              <s-option value="90">Last 90 days</s-option>
              <s-option value="365">Last 365 days</s-option>
              <s-option value="all">All time</s-option>
              <s-option value="custom">Custom range</s-option>
            </s-select>
            <s-text-field
              name="from"
              label="From"
              value={data.range.fromInput}
              details="Used when range is Custom"
            />
            <s-text-field
              name="to"
              label="To"
              value={data.range.toInput}
              details="YYYY-MM-DD"
            />
            <s-button type="submit" variant="primary">
              Apply
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <Stat label="Total Reviews" value={data.overview.totalReviews} />
          <Stat label="Published" value={data.overview.published} />
          <Stat label="Pending" value={data.overview.pending} />
          <Stat label="Rejected" value={data.overview.rejected} />
          <Stat label="Average Rating" value={formatAverageRating(data.overview.averageRating)} />
          <Stat label="Review Requests" value={data.overview.reviewRequests} />
          <Stat label="Sent Requests" value={data.overview.sentRequests} />
          <Stat label="Completed Requests" value={data.overview.completedRequests} />
          <Stat label="Completion Rate" value={data.overview.completionRate} />
        </s-stack>
      </s-section>

      <s-section heading={`Review trend (${data.granularity})`}>
        {data.trend.length === 0 ? (
          <s-paragraph>No reviews were created in this range.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small-200">
            {data.trend.map((point) => (
              <s-stack key={point.label} direction="inline" gap="base">
                <s-text>{point.label}</s-text>
                <s-box
                  background="strong"
                  borderRadius="base"
                  minBlockSize="8px"
                  inlineSize={`${Math.max(4, Math.round((point.count / maxTrend) * 100))}%`}
                />
                <s-text>{point.count}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Rating distribution">
        {data.ratings.length === 0 ? (
          <s-paragraph>No ratings in this range.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Rating</s-table-header>
              <s-table-header>Reviews</s-table-header>
              <s-table-header>Share</s-table-header>
            </s-table-header-row>
            {data.ratings.map((row) => (
              <s-table-row key={row.rating}>
                <s-table-cell>{row.rating} star</s-table-cell>
                <s-table-cell>{row.count}</s-table-cell>
                <s-table-cell>{row.percent}</s-table-cell>
              </s-table-row>
            ))}
          </s-table>
        )}
      </s-section>

      <s-section heading="Request funnel">
        {data.funnel.created === 0 ? (
          <s-paragraph>No review requests were created in this range.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>Created: {data.funnel.created}</s-paragraph>
            <s-paragraph>
              Sent: {data.funnel.sent} ({data.funnel.sentRate} of created)
            </s-paragraph>
            <s-paragraph>
              Completed: {data.funnel.completed} ({data.funnel.completedRate} of sent)
            </s-paragraph>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Product performance">
        {data.products.length === 0 ? (
          <s-paragraph>No product reviews in this range.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>
                <s-link href={queryString(data, { sort: "reviews", direction: data.sort === "reviews" && data.direction === "desc" ? "asc" : "desc" })}>
                  Review count
                </s-link>
              </s-table-header>
              <s-table-header>
                <s-link href={queryString(data, { sort: "rating", direction: data.sort === "rating" && data.direction === "desc" ? "asc" : "desc" })}>
                  Average rating
                </s-link>
              </s-table-header>
              <s-table-header>
                <s-link href={queryString(data, { sort: "published", direction: data.sort === "published" && data.direction === "desc" ? "asc" : "desc" })}>
                  Published
                </s-link>
              </s-table-header>
              <s-table-header>
                <s-link href={queryString(data, { sort: "pending", direction: data.sort === "pending" && data.direction === "desc" ? "asc" : "desc" })}>
                  Pending
                </s-link>
              </s-table-header>
            </s-table-header-row>
            {data.products.map((product) => (
              <s-table-row key={product.productId}>
                <s-table-cell>{product.productTitle}</s-table-cell>
                <s-table-cell>{product.reviewCount}</s-table-cell>
                <s-table-cell>{formatAverageRating(product.averageRating)}</s-table-cell>
                <s-table-cell>{product.published}</s-table-cell>
                <s-table-cell>{product.pending}</s-table-cell>
              </s-table-row>
            ))}
          </s-table>
        )}
      </s-section>

      <s-section heading="Top rated products">
        {data.topRated.length === 0 ? (
          <s-paragraph>
            No product has at least {MIN_REVIEWS_FOR_RANKING} reviews in this range.
          </s-paragraph>
        ) : (
          <ProductList products={data.topRated} />
        )}
      </s-section>

      <s-section heading="Lowest rated products">
        {data.lowestRated.length === 0 ? (
          <s-paragraph>
            At least two products with {MIN_REVIEWS_FOR_RANKING} or more reviews are
            needed before a lowest-rated list is meaningful.
          </s-paragraph>
        ) : (
          <ProductList products={data.lowestRated} />
        )}
      </s-section>

      <s-section heading="Recent activity">
        {data.activity.length === 0 ? (
          <s-paragraph>No review or request activity in this range.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Activity</s-table-header>
              <s-table-header listSlot="secondary">Detail</s-table-header>
              <s-table-header>When</s-table-header>
            </s-table-header-row>
            {data.activity.map((item) => (
              <s-table-row key={item.id}>
                <s-table-cell>
                  {item.type}: {item.label}
                </s-table-cell>
                <s-table-cell>{item.detail}</s-table-cell>
                <s-table-cell>{formatDateTime(item.at)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function ProductList({
  products,
}: {
  products: AnalyticsData["products"];
}) {
  return (
    <s-unordered-list>
      {products.map((product) => (
        <s-list-item key={product.productId}>
          {product.productTitle} — {formatAverageRating(product.averageRating)} from{" "}
          {product.reviewCount} reviews
        </s-list-item>
      ))}
    </s-unordered-list>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
