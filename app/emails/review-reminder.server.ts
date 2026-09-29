import {
  REVIEW_EMAIL_CTA,
  emailCustomerLabel,
  emailProductLabel,
  reviewReminderSubject,
} from "./content";
import { renderReviewEmailHtml } from "./layout.server";

export function buildReviewReminderEmail(input: {
  customerName: string | null;
  productTitle: string | null;
  reviewUrl: string;
}) {
  const productTitle = emailProductLabel(input.productTitle);
  const customerName = emailCustomerLabel(input.customerName);
  const subject = reviewReminderSubject(input.productTitle);

  return {
    subject,
    text: `Hi ${customerName},\n\nThis is a reminder to share your feedback on ${productTitle}.\n\n${REVIEW_EMAIL_CTA}: ${input.reviewUrl}\n\nRG Review`,
    html: renderReviewEmailHtml({
      previewText: subject,
      heading: "We'd still love your feedback",
      intro: "If you have a moment, tell us how this product worked for you.",
      productTitle,
      customerName,
      reviewUrl: input.reviewUrl,
      ctaLabel: REVIEW_EMAIL_CTA,
    }),
  };
}
