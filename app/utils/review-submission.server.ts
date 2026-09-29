export const REVIEW_SUBMISSION_LIMITS = {
  nameMax: 100,
  titleMax: 120,
  bodyMin: 10,
  bodyMax: 5000,
  emailMax: 254,
  duplicateWindowMs: 5 * 60 * 1000,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ReviewSubmissionInput = {
  productIdRaw: string;
  ratingRaw: string;
  titleRaw: string;
  bodyRaw: string;
  customerNameRaw: string;
  customerEmailRaw: string;
};

export type ValidatedReviewSubmission = {
  productNumericId: string;
  productGid: string;
  rating: number;
  title: string | null;
  body: string;
  customerName: string | null;
  customerEmail: string | null;
};

export type ReviewSubmissionValidationResult =
  | { ok: true; data: ValidatedReviewSubmission }
  | { ok: false; errors: Record<string, string> };

function trimValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseReviewSubmissionFormData(
  formData: FormData,
): ReviewSubmissionInput {
  return {
    productIdRaw: trimValue(formData.get("product_id")),
    ratingRaw: trimValue(formData.get("rating")),
    titleRaw: trimValue(formData.get("title")),
    bodyRaw: trimValue(formData.get("body")),
    customerNameRaw: trimValue(formData.get("customer_name")),
    customerEmailRaw: trimValue(formData.get("customer_email")),
  };
}

export function validateReviewContent(input: {
  ratingRaw: string;
  titleRaw: string;
  bodyRaw: string;
}):
  | { ok: true; rating: number; title: string | null; body: string }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const rating = Number.parseInt(input.ratingRaw, 10);

  if (
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    String(rating) !== input.ratingRaw
  ) {
    errors.rating = "Please select a rating from 1 to 5 stars.";
  }

  if (input.titleRaw.length > REVIEW_SUBMISSION_LIMITS.titleMax) {
    errors.title = `Title must be ${REVIEW_SUBMISSION_LIMITS.titleMax} characters or fewer.`;
  }

  if (!input.bodyRaw) {
    errors.body = "Review text is required.";
  } else if (input.bodyRaw.length < REVIEW_SUBMISSION_LIMITS.bodyMin) {
    errors.body = `Review text must be at least ${REVIEW_SUBMISSION_LIMITS.bodyMin} characters.`;
  } else if (input.bodyRaw.length > REVIEW_SUBMISSION_LIMITS.bodyMax) {
    errors.body = `Review text must be ${REVIEW_SUBMISSION_LIMITS.bodyMax} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    rating,
    title: input.titleRaw || null,
    body: input.bodyRaw,
  };
}

export function validateEmailAddress(email: string): string | null {
  if (!email) return "Email is required.";
  if (email.length > REVIEW_SUBMISSION_LIMITS.emailMax) {
    return `Email must be ${REVIEW_SUBMISSION_LIMITS.emailMax} characters or fewer.`;
  }
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
}

export function validateReviewSubmission(
  input: ReviewSubmissionInput,
): ReviewSubmissionValidationResult {
  const errors: Record<string, string> = {};

  if (!/^\d+$/.test(input.productIdRaw)) {
    errors.product_id = "A valid product is required.";
  }

  if (input.customerNameRaw.length > REVIEW_SUBMISSION_LIMITS.nameMax) {
    errors.customer_name = `Name must be ${REVIEW_SUBMISSION_LIMITS.nameMax} characters or fewer.`;
  }

  if (
    input.customerEmailRaw &&
    validateEmailAddress(input.customerEmailRaw)
  ) {
    errors.customer_email = "Enter a valid email address.";
  }

  const content = validateReviewContent(input);
  if (!content.ok) Object.assign(errors, content.errors);

  if (!content.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      productNumericId: input.productIdRaw,
      productGid: `gid://shopify/Product/${input.productIdRaw}`,
      rating: content.rating,
      title: content.title,
      body: content.body,
      customerName: input.customerNameRaw || null,
      customerEmail: input.customerEmailRaw
        ? input.customerEmailRaw.toLowerCase()
        : null,
    },
  };
}
