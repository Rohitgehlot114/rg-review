import prisma from "../db.server";
import {
  orderCountsAsPurchase,
  orderSearchQuery,
} from "../utils/purchase-rules";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const ORDERS_PER_CUSTOMER = 10;
const LINE_ITEM_PAGE_SIZE = 50;
const MAX_LINE_ITEM_PAGES = 3;

function logVerification(
  event: "success" | "no match" | "lookup failed",
  shop: string,
  reviewId: string,
) {
  const line = `[rg-review] verified purchase ${event} shop=${shop} review=${reviewId}`;
  if (event === "lookup failed") console.error(line);
  else console.info(line);
}

function productMatches(
  nodes: Array<{ product?: { id?: string | null } | null }>,
  productGid: string,
): boolean {
  return nodes.some((node) => node.product?.id === productGid);
}

type OrderNode = {
  id?: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  lineItems?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: Array<{ product?: { id?: string | null } | null }>;
  };
};

async function readGraphql(
  admin: AdminGraphql,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const response = await admin.graphql(query, { variables });
  return response.json();
}

async function lineItemsIncludeProduct(
  admin: AdminGraphql,
  order: OrderNode,
  productGid: string,
): Promise<boolean> {
  const firstPage = order.lineItems?.nodes ?? [];
  if (productMatches(firstPage, productGid)) return true;

  let hasNextPage = Boolean(order.lineItems?.pageInfo?.hasNextPage);
  let cursor = order.lineItems?.pageInfo?.endCursor ?? null;
  const orderId = order.id;
  if (!orderId || !hasNextPage || !cursor) return false;

  for (let page = 1; page < MAX_LINE_ITEM_PAGES && hasNextPage && cursor; page += 1) {
    const payload = (await readGraphql(
      admin,
      `#graphql
        query ReviewPurchaseOrderItems($id: ID!, $after: String!) {
          order(id: $id) {
            lineItems(first: ${LINE_ITEM_PAGE_SIZE}, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                product {
                  id
                }
              }
            }
          }
        }`,
      { id: orderId, after: cursor },
    )) as {
      data?: {
        order?: {
          lineItems?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
            nodes?: Array<{ product?: { id?: string | null } | null }>;
          };
        } | null;
      };
    };

    const lineItems = payload.data?.order?.lineItems;
    if (productMatches(lineItems?.nodes ?? [], productGid)) return true;
    hasNextPage = Boolean(lineItems?.pageInfo?.hasNextPage);
    cursor = lineItems?.pageInfo?.endCursor ?? null;
  }

  return false;
}

function orderCanCount(order: OrderNode): boolean {
  return orderCountsAsPurchase(order);
}

async function customerPurchasedProduct(
  admin: AdminGraphql,
  email: string,
  productGid: string,
): Promise<boolean> {
  const payload = (await readGraphql(
    admin,
    `#graphql
      query ReviewPurchaseOrders($query: String!) {
        orders(first: ${ORDERS_PER_CUSTOMER}, query: $query) {
          nodes {
            id
            cancelledAt
            displayFinancialStatus
            lineItems(first: ${LINE_ITEM_PAGE_SIZE}) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                product {
                  id
                }
              }
            }
          }
        }
      }`,
    { query: orderSearchQuery(email) },
  )) as {
    data?: { orders?: { nodes?: OrderNode[] } };
    errors?: unknown[];
  };

  if (payload.errors?.length || !payload.data?.orders?.nodes) {
    throw new Error("order lookup failed");
  }

  for (const order of payload.data.orders.nodes) {
    if (!orderCanCount(order)) continue;
    if (await lineItemsIncludeProduct(admin, order, productGid)) return true;
  }

  return false;
}

export async function recordVerifiedPurchase(input: {
  admin: AdminGraphql;
  shop: string;
  reviewId: string;
  customerEmail: string | null;
  productId: string | null;
}): Promise<boolean> {
  try {
    const review = await prisma.review.findFirst({
      where: { id: input.reviewId, shop: input.shop },
      select: { id: true, verifiedPurchase: true },
    });

    if (!review) return false;
    if (review.verifiedPurchase) return true;

    const email = input.customerEmail?.trim() ?? "";
    const productId = input.productId?.trim() ?? "";
    if (!email || !productId) {
      logVerification("no match", input.shop, input.reviewId);
      return false;
    }

    const matched = await customerPurchasedProduct(input.admin, email, productId);
    if (!matched) {
      logVerification("no match", input.shop, input.reviewId);
      return false;
    }

    await prisma.review.updateMany({
      where: { id: review.id, shop: input.shop },
      data: { verifiedPurchase: true },
    });
    logVerification("success", input.shop, input.reviewId);
    return true;
  } catch {
    logVerification("lookup failed", input.shop, input.reviewId);
    return false;
  }
}
