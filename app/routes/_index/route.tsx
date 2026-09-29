import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>RG Review</h1>
        <p className={styles.text}>
          Collect and manage customer reviews for your Shopify store.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Manage customer reviews</strong>. Keep every review
            organized in one place inside Shopify Admin.
          </li>
          <li>
            <strong>Organize review moderation</strong>. Publish, hold, or
            reject feedback before it appears on your store.
          </li>
          <li>
            <strong>Prepare storefront display</strong>. Get reviews ready for
            widgets and product pages when you enable them.
          </li>
        </ul>
      </div>
    </div>
  );
}
