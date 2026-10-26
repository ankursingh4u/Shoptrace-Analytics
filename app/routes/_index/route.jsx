import { redirect } from "react-router";
import { Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <span className={styles.badge}>◉ Shoptrace Analytics</span>
        <h1 className={styles.heading}>Know exactly how visitors use your store</h1>
        <p className={styles.text}>
          Session recordings, click heatmaps, conversion funnels and on-site
          surveys for your Shopify storefront — private by design.
        </p>
        {showForm ? (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="my-shop-domain.myshopify.com" />
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        ) : null}
        <ul className={styles.list}>
          <li>
            <strong>Session recordings.</strong> Replay real visits pixel-for-pixel, with
            inputs masked.
          </li>
          <li>
            <strong>Heatmaps.</strong> See where visitors click and how far they scroll on
            any page.
          </li>
          <li>
            <strong>Funnels & surveys.</strong> Find where carts stall and ask visitors why,
            right on the page.
          </li>
        </ul>
      </div>
    </div>
  );
}
