import { randomBytes } from "node:crypto";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type DiscountDraft = {
  title: string;
  code: string;
  startsAt: string;
  endsAt: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minimumPurchase: number | null;
  usageLimit: number;
  onePerCustomer: boolean;
};

export type DiscountCreateResult =
  | { ok: true; shopifyDiscountId: string }
  | { ok: false; uncertain: boolean };

export function generateRewardCode(): string {
  return `RG-REVIEW-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function basicCodeDiscount(draft: DiscountDraft): Record<string, unknown> {
  const value =
    draft.discountType === "percentage"
      ? { percentage: draft.discountValue / 100 }
      : {
          discountAmount: {
            amount: draft.discountValue.toFixed(2),
            appliesOnEachItem: false,
          },
        };

  const input: Record<string, unknown> = {
    title: draft.title,
    code: draft.code,
    startsAt: draft.startsAt,
    customerSelection: { all: true },
    customerGets: {
      value,
      items: { all: true },
    },
    usageLimit: draft.usageLimit,
    appliesOncePerCustomer: draft.onePerCustomer,
  };

  if (draft.endsAt) input.endsAt = draft.endsAt;
  if (draft.minimumPurchase !== null && draft.minimumPurchase > 0) {
    input.minimumRequirement = {
      subtotal: {
        greaterThanOrEqualToSubtotal: draft.minimumPurchase.toFixed(2),
      },
    };
  }

  return input;
}

async function readGraphql(
  admin: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  return response.json();
}

export async function loadShopCurrencyCode(
  admin: AdminGraphql,
): Promise<string | null> {
  try {
    const payload = (await readGraphql(
      admin,
      `#graphql
        query ReviewRewardShopCurrency {
          shop {
            currencyCode
          }
        }`,
    )) as { data?: { shop?: { currencyCode?: string | null } | null } };
    const code = payload.data?.shop?.currencyCode?.trim();
    return code || null;
  } catch {
    return null;
  }
}

export async function findDiscountIdByCode(
  admin: AdminGraphql,
  code: string,
): Promise<string | null> {
  const payload = (await readGraphql(
    admin,
    `#graphql
      query ReviewRewardDiscountByCode($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          id
        }
      }`,
    { code },
  )) as {
    data?: { codeDiscountNodeByCode?: { id?: string | null } | null };
    errors?: unknown[];
  };

  if (payload.errors?.length) {
    throw new Error("discount lookup failed");
  }

  return payload.data?.codeDiscountNodeByCode?.id ?? null;
}

export async function createBasicDiscountCode(
  admin: AdminGraphql,
  draft: DiscountDraft,
): Promise<DiscountCreateResult> {
  try {
    const payload = (await readGraphql(
      admin,
      `#graphql
        mutation CreateReviewRewardDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
      { basicCodeDiscount: basicCodeDiscount(draft) },
    )) as {
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id?: string | null } | null;
          userErrors?: Array<{ message?: string | null }>;
        } | null;
      };
      errors?: unknown[];
    };

    if (payload.errors?.length) {
      return { ok: false, uncertain: false };
    }

    const created = payload.data?.discountCodeBasicCreate;
    const userErrors = created?.userErrors ?? [];
    if (userErrors.length > 0) {
      const taken = userErrors.some((error) =>
        (error.message ?? "").toLowerCase().includes("taken"),
      );
      if (taken) {
        const existingId = await findDiscountIdByCode(admin, draft.code);
        if (existingId) return { ok: true, shopifyDiscountId: existingId };
      }
      return { ok: false, uncertain: false };
    }

    const id = created?.codeDiscountNode?.id;
    if (!id) return { ok: false, uncertain: true };
    return { ok: true, shopifyDiscountId: id };
  } catch {
    return { ok: false, uncertain: true };
  }
}

export type DiscountUsage = {
  shopifyDiscountId: string;
  present: boolean;
  status: string | null;
  endsAt: string | null;
  usageCount: number | null;
};

export async function loadDiscountUsage(
  admin: AdminGraphql,
  ids: string[],
): Promise<DiscountUsage[] | null> {
  if (ids.length === 0) return [];

  try {
    const payload = (await readGraphql(
      admin,
      `#graphql
        query ReviewRewardDiscountUsage($ids: [ID!]!) {
          nodes(ids: $ids) {
            id
            ... on DiscountCodeNode {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  status
                  endsAt
                  asyncUsageCount
                }
              }
            }
          }
        }`,
      { ids },
    )) as {
      data?: {
        nodes?: Array<{
          id?: string | null;
          codeDiscount?: {
            status?: string | null;
            endsAt?: string | null;
            asyncUsageCount?: number | null;
          } | null;
        } | null> | null;
      };
      errors?: unknown[];
    };

    const nodes = payload.data?.nodes;
    if (payload.errors?.length || !Array.isArray(nodes) || nodes.length !== ids.length) {
      return null;
    }

    return ids.map((id, index) => {
      const node = nodes[index];
      if (!node?.id) {
        return {
          shopifyDiscountId: id,
          present: false,
          status: null,
          endsAt: null,
          usageCount: null,
        };
      }

      return {
        shopifyDiscountId: node.id,
        present: true,
        status: node.codeDiscount?.status ?? null,
        endsAt: node.codeDiscount?.endsAt ?? null,
        usageCount:
          typeof node.codeDiscount?.asyncUsageCount === "number"
            ? node.codeDiscount.asyncUsageCount
            : null,
      };
    });
  } catch {
    return null;
  }
}
