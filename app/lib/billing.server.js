// Shopify App Pricing (managed pricing) integration.
//
// Plans live in the dev dashboard (Pricing section) and Shopify hosts the
// plan-selection/approval page; the app's only job is to check the active
// subscription through the Partner API and send merchants to the hosted page
// when they don't have one. No Billing API mutations are involved.
//
// Plan handles expected in the dashboard: starter ($15), growth ($30),
// scale ($61) — monthly. The gate is a no-op until the Partner API env vars
// are configured, so the app keeps working before plans are published.

const PARTNER_API_VERSION = "2026-07";

export const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "shoptrace-analytics";

export const PLANS = {
  starter: { name: "Starter", price: 15 },
  growth: { name: "Growth", price: 30 },
  scale: { name: "Scale", price: 61 },
};

export const billingEnabled = () =>
  Boolean(
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN &&
      process.env.SHOPIFY_PARTNER_ORG_ID &&
      process.env.SHOPIFY_APP_GID,
  );

// shop domain -> { value, expires } (Partner API allows 4 req/s per client,
// and the docs recommend ~5 minute caching of confirmed subscriptions)
const subCache = new Map();
const shopIdCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

async function fetchActiveSubscription(shopId) {
  const res = await fetch(
    `https://partners.shopify.com/${process.env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: `query ($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            billingPeriod
            trialEndsAt
            cancelAtEndOfCycle
            items { handle }
          }
        }`,
        variables: { appId: process.env.SHOPIFY_APP_GID, shopId },
      }),
    },
  );
  const { data, errors } = await res.json();
  if (!res.ok || errors) {
    throw new Error(`Partner API request failed: ${JSON.stringify(errors ?? res.status)}`);
  }
  return data.activeSubscription;
}

// Returns { active, planHandle, plan, trialEndsAt } — always active when
// billing isn't configured yet. Fails OPEN on Partner API errors so an
// outage never locks paying merchants out.
export async function getSubscription(admin, session) {
  if (!billingEnabled()) {
    return { active: true, planHandle: "dev", plan: { name: "Development", price: 0 } };
  }
  const cached = subCache.get(session.shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    let shopId = shopIdCache.get(session.shop);
    if (!shopId) {
      const res = await admin.graphql(`{ shop { id } }`);
      shopId = (await res.json()).data.shop.id;
      shopIdCache.set(session.shop, shopId);
    }
    const sub = await fetchActiveSubscription(shopId);
    const planHandle = sub?.items?.[0]?.handle || null;
    const value = sub
      ? {
          active: true,
          planHandle,
          plan: PLANS[planHandle] || { name: planHandle || "Unknown", price: null },
          trialEndsAt: sub.trialEndsAt || null,
        }
      : { active: false, planHandle: null, plan: null };
    subCache.set(session.shop, { value, expires: Date.now() + CACHE_MS });
    return value;
  } catch (e) {
    console.error("[billing] subscription check failed, failing open:", e?.message);
    return { active: true, planHandle: null, plan: null, degraded: true };
  }
}

// Shopify-hosted plan selection page for this app.
export function planSelectionUrl(shop) {
  const storeHandle = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

// Call after a merchant returns from the plan page so the next check is fresh.
export function invalidateSubscriptionCache(shop) {
  subCache.delete(shop);
}
