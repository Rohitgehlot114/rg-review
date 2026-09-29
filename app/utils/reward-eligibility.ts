export type RewardBlockReason =
  | "disabled"
  | "not_published"
  | "already_issued"
  | "missing_email"
  | "invalid_settings"
  | "not_verified"
  | "one_per_customer";

export function rewardBlockReason(input: {
  enabled: boolean;
  status: string;
  hasEmail: boolean;
  alreadyIssued: boolean;
  discountType: string;
  discountValue: number;
  usageLimit: number;
  trigger: string;
  verifiedPurchase: boolean;
  onePerCustomer: boolean;
  customerAlreadyRewarded: boolean;
}): RewardBlockReason | null {
  if (!input.enabled) return "disabled";
  if (input.status !== "published") return "not_published";
  if (input.alreadyIssued) return "already_issued";
  if (!input.hasEmail) return "missing_email";
  if (
    input.discountValue <= 0 ||
    (input.discountType === "percentage" && input.discountValue > 100) ||
    input.usageLimit < 1
  ) {
    return "invalid_settings";
  }
  if (input.trigger === "published_verified" && !input.verifiedPurchase) {
    return "not_verified";
  }
  if (input.onePerCustomer && input.customerAlreadyRewarded) {
    return "one_per_customer";
  }
  return null;
}
