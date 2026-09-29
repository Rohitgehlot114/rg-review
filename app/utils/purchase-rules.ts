const EXCLUDED_FINANCIAL_STATUSES = new Set([
  "REFUNDED",
  "VOIDED",
  "EXPIRED",
]);

export function orderCountsAsPurchase(input: {
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
}): boolean {
  if (input.cancelledAt) return false;
  const financial = input.displayFinancialStatus ?? "";
  if (EXCLUDED_FINANCIAL_STATUSES.has(financial)) return false;
  return true;
}

export function orderSearchQuery(email: string): string {
  const escaped = email.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `email:"${escaped}" -status:cancelled`;
}
