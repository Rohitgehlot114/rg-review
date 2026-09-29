import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ProductsPage() {
  return (
    <s-page heading="Products">
      <s-section>
        <s-paragraph>
          Products associated with customer reviews will appear here. Use this
          view to see which items have reviews and manage product-level review
          visibility once review storage is connected.
        </s-paragraph>
      </s-section>

      <s-section heading="Products with reviews">
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-heading>No products yet</s-heading>
            <s-paragraph>
              Product review summaries will show here after reviews are
              collected. Shopify product data is not queried from this page yet.
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
