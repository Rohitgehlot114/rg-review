import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  countPendingRewards,
  refreshListedRewardStatuses,
  resendRewardEmail,
} from "../services/rewards.server";
import { PAGE_SIZE, formatDateTime } from "../utils/reviews";
import {
  formatDiscount,
  formatExpiration,
  rewardStatusLabel,
  rewardStatusTone,
} from "../utils/rewards";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function presentReward(reward: {
  id: string;
  customerName: string | null;
  customerEmail: string;
  productTitle: string | null;
  discountType: string;
  discountValue: { toString(): string };
  currencyCode: string;
  discountCode: string;
  status: string;
  emailStatus: string;
  issuedAt: Date;
  expiresAt: Date | null;
  review: { verifiedPurchase: boolean } | null;
}) {
  const value = reward.discountValue.toString();
  return {
    id: reward.id,
    customerName: reward.customerName,
    customerEmail: reward.customerEmail,
    productTitle: reward.productTitle,
    discountLabel: formatDiscount(
      reward.discountType,
      reward.discountType === "percentage" ? value : Number(value).toFixed(2),
      reward.currencyCode,
    ),
    discountCode: reward.discountCode,
    verifiedPurchase: reward.review?.verifiedPurchase === true,
    status: reward.status,
    emailStatus: reward.emailStatus,
    issuedAt: reward.issuedAt.toISOString(),
    expiresAt: reward.expiresAt?.toISOString() ?? null,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  let page = parsePage(url.searchParams.get("page"));
  const rewardId = url.searchParams.get("reward")?.trim() ?? "";

  const where = { shop, shopifyDiscountId: { not: null } };
  const issuedRows = await prisma.reviewReward.findMany({
    where,
    select: {
      id: true,
      shopifyDiscountId: true,
      status: true,
      emailStatus: true,
      expiresAt: true,
      redeemedAt: true,
    },
  });

  for (let index = 0; index < issuedRows.length; index += 50) {
    await refreshListedRewardStatuses(
      admin,
      shop,
      issuedRows.slice(index, index + 50),
    );
  }

  const [issued, verifiedReviews, activeCoupons, redeemedCoupons, pending, totalCount] =
    await Promise.all([
      prisma.reviewReward.count({ where }),
      prisma.review.count({ where: { shop, verifiedPurchase: true } }),
      prisma.reviewReward.count({
        where: {
          shop,
          status: "active",
          shopifyDiscountId: { not: null },
        },
      }),
      prisma.reviewReward.count({ where: { shop, status: "redeemed" } }),
      countPendingRewards(shop),
      prisma.reviewReward.count({ where }),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  if (page > totalPages) page = totalPages;

  const [rows, selected] = await Promise.all([
    prisma.reviewReward.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { review: { select: { verifiedPurchase: true } } },
    }),
    rewardId
      ? prisma.reviewReward.findFirst({
          where: { id: rewardId, shop, shopifyDiscountId: { not: null } },
          include: { review: { select: { verifiedPurchase: true } } },
        })
      : Promise.resolve(null),
  ]);

  return {
    stats: {
      issued,
      verifiedReviews,
      activeCoupons,
      redeemedCoupons,
      pending,
    },
    rewards: rows.map(presentReward),
    selectedReward: selected ? presentReward(selected) : null,
    selectedRewardMissing: Boolean(rewardId) && !selected,
    pagination: {
      page,
      totalPages,
      totalCount,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
    },
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "resend") {
    return { ok: false, error: "Invalid reward action." };
  }

  const rewardId = String(formData.get("id") ?? "").trim();
  if (!rewardId) return { ok: false, error: "Invalid reward." };

  try {
    return await resendRewardEmail({ shop: session.shop, rewardId });
  } catch {
    return { ok: false, error: "The reward email could not be sent." };
  }
};

export default function RewardsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const detailModalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const isActing =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message);
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (data.selectedReward) detailModalRef.current?.showOverlay?.();
  }, [data.selectedReward]);

  useEffect(() => {
    if (data.selectedRewardMissing) {
      shopify.toast.show("Reward not found.", { isError: true });
    }
  }, [data.selectedRewardMissing, shopify]);

  function pageHref(page: number) {
    const next = new URLSearchParams(searchParams);
    next.delete("reward");
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const query = next.toString();
    return query ? `/app/rewards?${query}` : "/app/rewards";
  }

  function rewardHref(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set("reward", id);
    return `/app/rewards?${next.toString()}`;
  }

  const closeDetailHref = pageHref(data.pagination.page);
  const empty = data.stats.issued === 0;

  return (
    <s-page heading="Rewards">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{data.stats.issued}</s-text>
            <s-paragraph>Rewards Issued</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{data.stats.verifiedReviews}</s-text>
            <s-paragraph>Verified Reviews</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{data.stats.activeCoupons}</s-text>
            <s-paragraph>Active Coupons</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{data.stats.redeemedCoupons}</s-text>
            <s-paragraph>Redeemed Coupons</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{data.stats.pending}</s-text>
            <s-paragraph>Pending Rewards</s-paragraph>
          </s-box>
        </s-stack>
      </s-section>

      <s-section>
        {empty ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>No rewards yet</s-heading>
              <s-paragraph>
                Rewards appear here after you publish an eligible review and
                Shopify accepts the discount code. There are no rewards for
                this store yet.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="secondary">Product</s-table-header>
                <s-table-header>Discount</s-table-header>
                <s-table-header>Coupon</s-table-header>
                <s-table-header>Verified Purchase</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Issued</s-table-header>
                <s-table-header>Expires</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              {data.rewards.map((reward) => (
                <s-table-row key={reward.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-200">
                      <s-text>{reward.customerName?.trim() || "Customer"}</s-text>
                      <s-text>{reward.customerEmail}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{reward.productTitle?.trim() || "—"}</s-table-cell>
                  <s-table-cell>{reward.discountLabel}</s-table-cell>
                  <s-table-cell>{reward.discountCode}</s-table-cell>
                  <s-table-cell>
                    {reward.verifiedPurchase ? (
                      <s-badge tone="success">Verified Purchase</s-badge>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={rewardStatusTone(reward)}>
                      {rewardStatusLabel(reward)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatExpiration(reward.issuedAt)}</s-table-cell>
                  <s-table-cell>{formatExpiration(reward.expiresAt)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button href={rewardHref(reward.id)} variant="tertiary">
                        View
                      </s-button>
                      <s-button
                        variant="tertiary"
                        {...(isActing ? { loading: true } : {})}
                        onClick={() => {
                          fetcher.submit(
                            { intent: "resend", id: reward.id },
                            { method: "post" },
                          );
                        }}
                      >
                        Resend Email
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

      <s-modal
        id="reward-detail-modal"
        heading="Reward details"
        ref={detailModalRef}
        onHide={() => {
          if (searchParams.get("reward")) navigate(closeDetailHref);
        }}
      >
        {data.selectedReward ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              <s-text type="strong">Customer: </s-text>
              {data.selectedReward.customerName?.trim() || "Customer"} (
              {data.selectedReward.customerEmail})
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Product: </s-text>
              {data.selectedReward.productTitle?.trim() || "—"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Discount: </s-text>
              {data.selectedReward.discountLabel}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Coupon: </s-text>
              {data.selectedReward.discountCode}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Verified purchase: </s-text>
              {data.selectedReward.verifiedPurchase ? "Verified Purchase" : "Not verified"}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Issued: </s-text>
              {formatDateTime(data.selectedReward.issuedAt)}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Expiration: </s-text>
              {formatExpiration(data.selectedReward.expiresAt)}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Status: </s-text>
              {rewardStatusLabel(data.selectedReward)}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Email status: </s-text>
              {data.selectedReward.emailStatus === "sent"
                ? "Sent"
                : data.selectedReward.emailStatus === "failed"
                  ? "Failed"
                  : "Not sent"}
            </s-paragraph>
          </s-stack>
        ) : (
          <s-paragraph>Select a reward to view details.</s-paragraph>
        )}
        <s-button
          slot="secondary-actions"
          commandFor="reward-detail-modal"
          command="--hide"
        >
          Close
        </s-button>
        {data.selectedReward ? (
          <s-button
            slot="primary-action"
            {...(isActing ? { loading: true } : {})}
            onClick={() => {
              if (!data.selectedReward) return;
              fetcher.submit(
                { intent: "resend", id: data.selectedReward.id },
                { method: "post" },
              );
            }}
          >
            Resend Email
          </s-button>
        ) : null}
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
