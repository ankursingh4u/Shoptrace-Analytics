import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  billingEnabled,
  getSubscription,
  invalidateSubscriptionCache,
  planSelectionUrl,
} from "../lib/billing.server";

import "@shopify/polaris/build/esm/styles.css";

import enTranslations from "@shopify/polaris/locales/en.json";

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  // Shopify appends plan_handle to the welcome link after a merchant approves
  // a plan — drop the cached (stale) subscription so the gate sees it.
  if (new URL(request.url).searchParams.has("plan_handle")) {
    invalidateSubscriptionCache(session.shop);
  }
  const subscription = await getSubscription(admin, session);
  if (!subscription.active) {
    // Plan selection is a Shopify-hosted page outside the app iframe.
    return redirect(planSelectionUrl(session.shop), { target: "_top" });
  }
  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    plan: subscription.plan,
    planHandle: subscription.planHandle,
    trialEndsAt: subscription.trialEndsAt || null,
    showPlansLink: billingEnabled(),
  };
};

export default function App() {
  const { apiKey, showPlansLink } = useLoaderData();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <ui-nav-menu>
          <a href="/app" rel="home">Dashboard</a>
          <a href="/app/recordings">Recordings</a>
          <a href="/app/heatmaps">Heatmaps</a>
          <a href="/app/surveys">Surveys</a>
          <a href="/app/settings">Settings</a>
          {showPlansLink ? <a href="/app/plans">Plans</a> : null}
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
