import assert from "node:assert/strict";
import test from "node:test";

import { csvCell } from "../app/utils/csv.ts";
import { mapPublishedReviewForStorefront, publishedReviewsWhere } from "../app/utils/published-reviews.server.ts";
import { orderCountsAsPurchase, orderSearchQuery } from "../app/utils/purchase-rules.ts";
import { rewardBlockReason } from "../app/utils/reward-eligibility.ts";
import { parseRewardSettings } from "../app/utils/reward-settings.ts";
import { reminderStageDue } from "../app/utils/review-reminder-schedule.ts";
import {
  createReviewRequestToken,
  isReviewRequestToken,
} from "../app/utils/review-request-token.ts";

const day = 24 * 60 * 60 * 1000;

test("reward settings reject invalid values and stay off without a saved value", () => {
  const disabled = parseRewardSettings({
    enabled: false,
    trigger: "published",
    discountType: "percentage",
    discountValue: "",
    expirationDays: "30",
    minimumPurchase: "",
    usageLimit: "1",
    onePerCustomer: true,
  });
  assert.equal(disabled.ok, true);
  if (disabled.ok) assert.equal(disabled.settings.enabled, false);

  const missingValue = parseRewardSettings({
    enabled: true,
    trigger: "published_verified",
    discountType: "percentage",
    discountValue: "",
    expirationDays: "never",
    minimumPurchase: "",
    usageLimit: "1",
    onePerCustomer: true,
  });
  assert.equal(missingValue.ok, false);

  const tooHigh = parseRewardSettings({
    enabled: true,
    trigger: "published",
    discountType: "percentage",
    discountValue: "150",
    expirationDays: "7",
    minimumPurchase: "-1",
    usageLimit: "1",
    onePerCustomer: false,
  });
  assert.equal(tooHigh.ok, false);
});

test("reward eligibility blocks unverified, duplicate, and disabled rewards", () => {
  assert.equal(
    rewardBlockReason({
      enabled: false,
      status: "published",
      hasEmail: true,
      alreadyIssued: false,
      discountType: "percentage",
      discountValue: 10,
      usageLimit: 1,
      trigger: "published",
      verifiedPurchase: true,
      onePerCustomer: true,
      customerAlreadyRewarded: false,
    }),
    "disabled",
  );
  assert.equal(
    rewardBlockReason({
      enabled: true,
      status: "published",
      hasEmail: true,
      alreadyIssued: true,
      discountType: "fixed",
      discountValue: 5,
      usageLimit: 1,
      trigger: "published",
      verifiedPurchase: false,
      onePerCustomer: false,
      customerAlreadyRewarded: false,
    }),
    "already_issued",
  );
  assert.equal(
    rewardBlockReason({
      enabled: true,
      status: "published",
      hasEmail: true,
      alreadyIssued: false,
      discountType: "percentage",
      discountValue: 10,
      usageLimit: 1,
      trigger: "published_verified",
      verifiedPurchase: false,
      onePerCustomer: false,
      customerAlreadyRewarded: false,
    }),
    "not_verified",
  );
  assert.equal(
    rewardBlockReason({
      enabled: true,
      status: "pending",
      hasEmail: true,
      alreadyIssued: false,
      discountType: "percentage",
      discountValue: 10,
      usageLimit: 1,
      trigger: "published",
      verifiedPurchase: true,
      onePerCustomer: false,
      customerAlreadyRewarded: false,
    }),
    "not_published",
  );
  assert.equal(
    rewardBlockReason({
      enabled: true,
      status: "published",
      hasEmail: true,
      alreadyIssued: false,
      discountType: "percentage",
      discountValue: 10,
      usageLimit: 1,
      trigger: "published",
      verifiedPurchase: false,
      onePerCustomer: true,
      customerAlreadyRewarded: true,
    }),
    "one_per_customer",
  );
});

test("review request tokens are cryptographic and strictly validated", () => {
  const first = createReviewRequestToken();
  const second = createReviewRequestToken();
  assert.equal(isReviewRequestToken(first), true);
  assert.notEqual(first, second);
  assert.equal(isReviewRequestToken("short"), false);
  assert.equal(isReviewRequestToken(`${"a".repeat(42)}.`), false);
  assert.equal(isReviewRequestToken("../other-shop"), false);
});

test("published review queries stay on one shop and hide private fields", () => {
  const where = publishedReviewsWhere("shop-a.myshopify.com", "gid://shopify/Product/1");
  assert.equal(where.shop, "shop-a.myshopify.com");
  assert.equal(where.status, "published");
  assert.notEqual(where.shop, "shop-b.myshopify.com");

  const item = mapPublishedReviewForStorefront({
    customerName: "Rohit Gehlot",
    rating: 5,
    title: "Great",
    body: "Loved it",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    productTitle: "Mug",
    verifiedPurchase: true,
  });
  assert.equal(item.customerName, "Rohit G.");
  assert.equal(item.verifiedPurchase, true);
  assert.equal("customerEmail" in item, false);
  assert.equal("id" in item, false);
  assert.equal("rewardCode" in item, false);
});

test("purchase rules ignore cancelled and refunded orders", () => {
  assert.equal(
    orderCountsAsPurchase({ cancelledAt: null, displayFinancialStatus: "PAID" }),
    true,
  );
  assert.equal(
    orderCountsAsPurchase({ cancelledAt: "2026-01-01", displayFinancialStatus: "PAID" }),
    false,
  );
  assert.equal(
    orderCountsAsPurchase({ cancelledAt: null, displayFinancialStatus: "REFUNDED" }),
    false,
  );
  assert.equal(
    orderCountsAsPurchase({ cancelledAt: null, displayFinancialStatus: "VOIDED" }),
    false,
  );
  assert.equal(orderSearchQuery('a"b@example.com').includes("-status:cancelled"), true);
  assert.equal(orderSearchQuery('a"b@example.com').includes('email:"a\\"b@example.com"'), true);
});

test("reminders follow 3, 7, and 14 days without repeating a stage", () => {
  const sentAt = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    reminderStageDue({
      sentAt,
      reminderCount: 0,
      lastReminderAt: null,
      now: new Date(sentAt.getTime() + 2 * day),
    }),
    false,
  );
  assert.equal(
    reminderStageDue({
      sentAt,
      reminderCount: 0,
      lastReminderAt: null,
      now: new Date(sentAt.getTime() + 3 * day),
    }),
    true,
  );
  assert.equal(
    reminderStageDue({
      sentAt,
      reminderCount: 1,
      lastReminderAt: new Date(sentAt.getTime() + 3 * day),
      now: new Date(sentAt.getTime() + 6 * day),
    }),
    false,
  );
  assert.equal(
    reminderStageDue({
      sentAt,
      reminderCount: 1,
      lastReminderAt: new Date(sentAt.getTime() + 3 * day),
      now: new Date(sentAt.getTime() + 7 * day),
    }),
    true,
  );
  assert.equal(
    reminderStageDue({
      sentAt,
      reminderCount: 3,
      lastReminderAt: new Date(sentAt.getTime() + 14 * day),
      now: new Date(sentAt.getTime() + 30 * day),
    }),
    false,
  );
});

test("csv cells escape quotes and spreadsheet formulas", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("=1+1"), `"'=1+1"`);
  assert.equal(csvCell("+cmd"), `"'+cmd"`);
  assert.equal(csvCell("@sum"), `"'@sum"`);
});
