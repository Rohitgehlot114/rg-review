import {
  REVIEW_EMAIL_CTA,
  emailCustomerLabel,
  emailProductLabel,
  reviewRequestSubject,
} from "./content";
import { renderReviewEmailHtml } from "./layout.server";

export function buildReviewRequestEmail(input: {
  customerName: string | null;
  productTitle: string | null;
  reviewUrl: string;
}) {
  const productTitle = emailProductLabel(input.productTitle);
  const customerName = emailCustomerLabel(input.customerName);
  const subject = reviewRequestSubject(input.productTitle);

  return {
    subject,
    text: `Hi ${customerName},\n\nWe would love to hear how ${productTitle} worked for you.\n\n${REVIEW_EMAIL_CTA}: ${input.reviewUrl}\n\nRG Review`,
    html: renderReviewEmailHtml({
      previewText: subject,
      heading: "How was your experience?",
      intro: "We would love to hear how this product worked for you.",
      productTitle,
      customerName,
      reviewUrl: input.reviewUrl,
      ctaLabel: REVIEW_EMAIL_CTA,
    }),
  };
}
