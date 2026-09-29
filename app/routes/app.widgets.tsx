import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function WidgetsPage() {
  return (
    <s-page heading="Widgets">
      <s-section>
        <s-paragraph>
          Configure how reviews appear on your storefront — product star
          ratings, review carousels, and other display widgets will be managed
          here.
        </s-paragraph>
      </s-section>

      <s-section heading="Storefront widgets">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-heading>Widgets coming soon</s-heading>
            <s-paragraph>
              Theme App Extension setup and widget configuration are not
              available yet. This page is ready for future widget controls such
              as star display, review lists, and placement options.
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
