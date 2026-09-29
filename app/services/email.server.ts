import { Resend } from "resend";

import { buildReviewReminderEmail } from "../emails/review-reminder.server";
import { buildReviewRequestEmail } from "../emails/review-request.server";

export type ReviewEmailKind = "request" | "reminder";

type DeliverInput = {
  kind: ReviewEmailKind;
  to: string;
  customerName: string | null;
  productTitle: string | null;
  reviewUrl: string;
  shop: string;
  requestId: string;
  logEvent?: string;
};

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

export function emailConfigurationError(): string | null {
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_FROM?.trim()) {
    return "Review emails are not configured. Add RESEND_API_KEY and EMAIL_FROM, then try again.";
  }
  return null;
}

function logEmail(
  level: "info" | "error",
  event: string,
  input: { shop: string; requestId: string; kind: ReviewEmailKind },
) {
  const line = `[rg-review] ${event} shop=${input.shop} request=${input.requestId} kind=${input.kind}`;
  if (level === "error") console.error(line);
  else console.info(line);
}

export async function deliverRewardEmail(input: {
  to: string;
  shop: string;
  reviewId: string;
  subject: string;
  html: string;
  text: string;
  logEvent: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const configurationError = emailConfigurationError();
  if (configurationError || !getResend() || !process.env.EMAIL_FROM?.trim()) {
    console.error(
      `[rg-review] reward email configuration missing shop=${input.shop} review=${input.reviewId}`,
    );
    return {
      ok: false,
      error:
        "Reward emails are not configured. Add RESEND_API_KEY and EMAIL_FROM, then try again.",
    };
  }

  const resend = getResend();
  const from = process.env.EMAIL_FROM?.trim();
  if (!resend || !from) {
    return {
      ok: false,
      error:
        "Reward emails are not configured. Add RESEND_API_KEY and EMAIL_FROM, then try again.",
    };
  }

  try {
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (result.error) {
      console.error(
        `[rg-review] reward email failure shop=${input.shop} review=${input.reviewId}`,
      );
      return {
        ok: false,
        error: "The reward email could not be sent. You can resend it from Rewards.",
      };
    }

    console.info(
      `[rg-review] ${input.logEvent} shop=${input.shop} review=${input.reviewId}`,
    );
    return { ok: true };
  } catch {
    console.error(
      `[rg-review] reward email failure shop=${input.shop} review=${input.reviewId}`,
    );
    return {
      ok: false,
      error: "The reward email could not be sent. You can resend it from Rewards.",
    };
  }
}

export async function deliverReviewEmail(
  input: DeliverInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const configurationError = emailConfigurationError();
  if (configurationError) {
    logEmail("error", "email configuration missing", input);
    return { ok: false, error: configurationError };
  }

  const resend = getResend();
  const from = process.env.EMAIL_FROM?.trim();
  if (!resend || !from) {
    logEmail("error", "email configuration missing", input);
    return {
      ok: false,
      error:
        "Review emails are not configured. Add RESEND_API_KEY and EMAIL_FROM, then try again.",
    };
  }

  const message =
    input.kind === "reminder"
      ? buildReviewReminderEmail(input)
      : buildReviewRequestEmail(input);

  try {
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (result.error) {
      logEmail("error", "email provider rejected", input);
      return {
        ok: false,
        error: "The email could not be sent. Please try again.",
      };
    }

    logEmail(
      "info",
      input.logEvent ??
        (input.kind === "reminder" ? "reminder sent" : "email sent"),
      input,
    );
    return { ok: true };
  } catch {
    logEmail("error", "email send failed", input);
    return {
      ok: false,
      error: "The email could not be sent. Please try again.",
    };
  }
}
