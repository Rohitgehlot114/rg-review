export function rewardStatusLabel(reward: {
  status: string;
  emailStatus: string;
}): string {
  if (reward.status === "redeemed") return "Redeemed";
  if (reward.status === "expired") return "Expired";
  if (reward.status === "cancelled") return "Cancelled";
  if (reward.emailStatus === "failed") return "Email Failed";
  if (reward.status === "active") return "Active";
  return "Pending";
}

export function rewardStatusTone(
  reward: { status: string; emailStatus: string },
): "success" | "warning" | "critical" | "info" | "neutral" {
  const label = rewardStatusLabel(reward);
  if (label === "Active") return "success";
  if (label === "Redeemed") return "info";
  if (label === "Email Failed") return "warning";
  if (label === "Expired" || label === "Cancelled") return "critical";
  return "neutral";
}

export function formatDiscount(
  discountType: string,
  discountValue: string,
  currencyCode: string,
): string {
  if (discountType === "percentage") return `${discountValue}%`;
  const currency = currencyCode.trim() || "fixed";
  return `${discountValue} ${currency}`;
}

export function formatExpiration(expiresAt: string | null): string {
  if (!expiresAt) return "Never";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
