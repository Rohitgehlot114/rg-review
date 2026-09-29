export function emailProductLabel(productTitle: string | null | undefined): string {
  const trimmed = productTitle?.trim();
  return trimmed || "your recent purchase";
}

export function emailCustomerLabel(customerName: string | null | undefined): string {
  const trimmed = customerName?.trim();
  return trimmed || "there";
}

export function reviewRequestSubject(productTitle: string | null | undefined): string {
  return `How was your experience with ${emailProductLabel(productTitle)}?`;
}

export function reviewReminderSubject(productTitle: string | null | undefined): string {
  return `We'd love your feedback on ${emailProductLabel(productTitle)}`;
}

export const REVIEW_EMAIL_CTA = "Leave Your Review";
