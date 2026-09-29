function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type RewardEmailContent = {
  customerName: string | null;
  productTitle: string | null;
  discountLabel: string;
  discountCode: string;
  expiresLabel: string;
  minimumLabel: string | null;
  usageLimit: number;
  storeUrl: string | null;
};

function displayName(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed || "there";
}

function productLabel(title: string | null): string {
  const trimmed = title?.trim();
  return trimmed || "your product";
}

export function buildReviewRewardEmail(input: RewardEmailContent): {
  subject: string;
  html: string;
  text: string;
} {
  const customerName = displayName(input.customerName);
  const productTitle = productLabel(input.productTitle);
  const subject = `Your RG Review reward for ${productTitle}`;
  const usageText =
    input.usageLimit === 1
      ? "This code can be used once."
      : `This code can be used ${input.usageLimit} times.`;
  const minimumText = input.minimumLabel
    ? `Minimum purchase: ${input.minimumLabel}.`
    : null;
  const storeLine = input.storeUrl
    ? `Shop now: ${input.storeUrl}`
    : "Enter this code at checkout.";

  const text = [
    "RG Review",
    "",
    `Hi ${customerName},`,
    "",
    `Thank you for reviewing ${productTitle}.`,
    `Your reward is ${input.discountLabel} off.`,
    `Coupon code: ${input.discountCode}`,
    `Expires: ${input.expiresLabel}`,
    usageText,
    minimumText,
    "",
    "Enter the code at checkout. Do not share it.",
    storeLine,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const cta = input.storeUrl
    ? `<tr><td style="padding-bottom:24px;"><a href="${escapeHtml(input.storeUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:12px 20px;border-radius:6px;">Shop now</a></td></tr>`
    : "";

  const minimumRow = minimumText
    ? `<tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px;">${escapeHtml(minimumText)}</td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f6f7;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(subject)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e3e3;border-radius:12px;padding:32px 28px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
            <tr><td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#616161;padding-bottom:16px;">RG Review</td></tr>
            <tr><td style="font-size:24px;line-height:1.3;font-weight:700;padding-bottom:12px;">Your review reward</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;padding-bottom:12px;">Hi ${escapeHtml(customerName)},</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;padding-bottom:12px;">Thank you for reviewing ${escapeHtml(productTitle)}. Here is your discount.</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;font-weight:700;padding-bottom:8px;">${escapeHtml(input.discountLabel)} off</td></tr>
            <tr><td style="font-size:20px;line-height:1.4;font-weight:700;letter-spacing:0.04em;padding:12px 0 16px;">${escapeHtml(input.discountCode)}</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px;">Expires: ${escapeHtml(input.expiresLabel)}</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px;">${escapeHtml(usageText)}</td></tr>
            ${minimumRow}
            <tr><td style="font-size:16px;line-height:1.5;padding:8px 0 24px;">Enter this code at checkout. Keep it private.</td></tr>
            ${cta}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
