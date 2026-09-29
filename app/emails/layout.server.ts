function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderReviewEmailHtml(input: {
  previewText: string;
  heading: string;
  intro: string;
  productTitle: string;
  customerName: string;
  reviewUrl: string;
  ctaLabel: string;
}): string {
  const previewText = escapeHtml(input.previewText);
  const heading = escapeHtml(input.heading);
  const intro = escapeHtml(input.intro);
  const productTitle = escapeHtml(input.productTitle);
  const customerName = escapeHtml(input.customerName);
  const reviewUrl = escapeHtml(input.reviewUrl);
  const ctaLabel = escapeHtml(input.ctaLabel);

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f6f7;">
    <div style="display:none;max-height:0;overflow:hidden;">${previewText}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e3e3;border-radius:12px;padding:32px 28px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
            <tr>
              <td style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#616161;padding-bottom:16px;">RG Review</td>
            </tr>
            <tr>
              <td style="font-size:24px;line-height:1.3;font-weight:700;padding-bottom:12px;">${heading}</td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;padding-bottom:12px;">Hi ${customerName},</td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;padding-bottom:12px;">${intro}</td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;font-weight:700;padding-bottom:24px;">${productTitle}</td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${reviewUrl}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:12px 20px;border-radius:6px;">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;line-height:1.5;color:#616161;">If the button does not work, copy this link into your browser:<br /><a href="${reviewUrl}" style="color:#111111;">${reviewUrl}</a></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
