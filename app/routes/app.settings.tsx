import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Prisma } from "@prisma/client";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  EMPTY_REWARD_SETTINGS,
  parseRewardSettings,
  type RewardSettingsInput,
} from "../utils/reward-settings";

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function flag(value: FormDataEntryValue | null): boolean {
  return value === "true";
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toInput(row: {
  enabled: boolean;
  trigger: string;
  discountType: string;
  discountValue: Prisma.Decimal;
  expirationDays: number | null;
  minimumPurchase: Prisma.Decimal | null;
  usageLimit: number;
  onePerCustomer: boolean;
}): RewardSettingsInput {
  const discount = row.discountValue.toString();
  return {
    enabled: row.enabled,
    trigger:
      row.trigger === "published_verified" ? "published_verified" : "published",
    discountType: row.discountType === "fixed" ? "fixed" : "percentage",
    discountValue: discount === "0" ? "" : discount,
    expirationDays:
      row.expirationDays === null ? "never" : String(row.expirationDays),
    minimumPurchase: row.minimumPurchase?.toString() ?? "",
    usageLimit: String(row.usageLimit),
    onePerCustomer: row.onePerCustomer,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const row = await prisma.rewardSettings.findUnique({
    where: { shop: session.shop },
  });

  return {
    rewards: row ? toInput(row) : EMPTY_REWARD_SETTINGS,
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "save-rewards") {
    return { ok: false, error: "Invalid settings action." };
  }

  const parsed = parseRewardSettings({
    enabled: flag(formData.get("enabled")),
    trigger: text(formData.get("trigger")) as RewardSettingsInput["trigger"],
    discountType: text(formData.get("discountType")) as RewardSettingsInput["discountType"],
    discountValue: text(formData.get("discountValue")),
    expirationDays: text(formData.get("expirationDays")),
    minimumPurchase: text(formData.get("minimumPurchase")),
    usageLimit: text(formData.get("usageLimit")),
    onePerCustomer: flag(formData.get("onePerCustomer")),
  });

  if (!parsed.ok) return parsed;

  const settings = parsed.settings;
  try {
    await prisma.rewardSettings.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        enabled: settings.enabled,
        trigger: settings.trigger,
        discountType: settings.discountType,
        discountValue: new Prisma.Decimal(settings.discountValue),
        expirationDays: settings.expirationDays,
        minimumPurchase:
          settings.minimumPurchase === null
            ? null
            : new Prisma.Decimal(settings.minimumPurchase),
        usageLimit: settings.usageLimit,
        onePerCustomer: settings.onePerCustomer,
      },
      update: {
        enabled: settings.enabled,
        trigger: settings.trigger,
        discountType: settings.discountType,
        discountValue: new Prisma.Decimal(settings.discountValue),
        expirationDays: settings.expirationDays,
        minimumPurchase:
          settings.minimumPurchase === null
            ? null
            : new Prisma.Decimal(settings.minimumPurchase),
        usageLimit: settings.usageLimit,
        onePerCustomer: settings.onePerCustomer,
      },
    });
  } catch {
    return { ok: false, error: "Reward settings could not be saved." };
  }

  return { ok: true, message: "Reward settings saved." };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const rewards = data.rewards;
  const isSaving =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message);
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Settings">
      <s-section>
        <s-paragraph>
          Review reward settings are saved for this store. Other preferences
          below are not available yet.
        </s-paragraph>
      </s-section>

      <s-section heading="Review Rewards">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="save-rewards" />
          <s-stack direction="block" gap="base">
            <s-select
              name="enabled"
              label="Enable rewards"
              value={rewards.enabled ? "true" : "false"}
            >
              <s-option value="false">Off</s-option>
              <s-option value="true">On</s-option>
            </s-select>
            <s-select name="trigger" label="Reward trigger" value={rewards.trigger}>
              <s-option value="published">Published reviews</s-option>
              <s-option value="published_verified">
                Published + Verified Purchase
              </s-option>
            </s-select>
            <s-select
              name="discountType"
              label="Discount type"
              value={rewards.discountType}
            >
              <s-option value="percentage">Percentage</s-option>
              <s-option value="fixed">Fixed amount</s-option>
            </s-select>
            <s-text-field
              name="discountValue"
              label="Discount value"
              value={rewards.discountValue}
              autocomplete="off"
              details="Percentage from 0.01 to 100, or a fixed amount in your store currency."
            />
            <s-select
              name="expirationDays"
              label="Coupon expiration"
              value={rewards.expirationDays}
            >
              <s-option value="7">7 days</s-option>
              <s-option value="14">14 days</s-option>
              <s-option value="30">30 days</s-option>
              <s-option value="60">60 days</s-option>
              <s-option value="90">90 days</s-option>
              <s-option value="never">Never</s-option>
            </s-select>
            <s-text-field
              name="minimumPurchase"
              label="Minimum purchase amount"
              value={rewards.minimumPurchase}
              autocomplete="off"
              details="Optional. Leave blank for no minimum."
            />
            <s-text-field
              name="usageLimit"
              label="Usage limit"
              value={rewards.usageLimit}
              autocomplete="off"
              details="How many times the Shopify code can be redeemed."
            />
            <s-select
              name="onePerCustomer"
              label="One reward per customer"
              value={rewards.onePerCustomer ? "true" : "false"}
            >
              <s-option value="true">On</s-option>
              <s-option value="false">Off</s-option>
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              {...(isSaving ? { loading: true } : {})}
            >
              Save reward settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="General">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-text type="strong">Store information</s-text>
            <s-paragraph>
              Store profile preferences for RG Review will appear here.
              Unavailable until settings storage is implemented.
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Storefront review form">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-text type="strong">Enable customer submissions</s-text>
            <s-paragraph>
              In the Shopify theme editor, open a product template and add the
              “RG Review Form” app block so customers can submit reviews. Add
              the “RG Review Reviews” block to show published reviews on the
              product page.
            </s-paragraph>
            <s-paragraph>
              New reviews stay Pending until you publish them. Only published
              reviews appear on the storefront.
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Review settings">
        <s-stack direction="block" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Review moderation</s-text>
              <s-paragraph>
                Choose whether new reviews require approval before publishing.
                Coming soon.
              </s-paragraph>
            </s-stack>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Default review status</s-text>
              <s-paragraph>
                Set the default status for new reviews (Pending or Published).
                Coming soon.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Display settings">
        <s-stack direction="block" gap="base">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Star rating display</s-text>
              <s-paragraph>
                Control how star ratings appear on product pages. Coming soon.
              </s-paragraph>
            </s-stack>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Review widget settings</s-text>
              <s-paragraph>
                Global defaults for storefront review widgets. Coming soon.
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
