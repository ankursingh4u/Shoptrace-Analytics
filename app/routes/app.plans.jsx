// /app/plans — jump to the Shopify-hosted plan selection page for this app
// (upgrade/downgrade both happen there under managed pricing).
import { authenticate } from "../shopify.server";
import { invalidateSubscriptionCache, planSelectionUrl } from "../lib/billing.server";

export const loader = async ({ request }) => {
  const { session, redirect } = await authenticate.admin(request);
  // The merchant may change plans while away, so refetch on return.
  invalidateSubscriptionCache(session.shop);
  return redirect(planSelectionUrl(session.shop), { target: "_top" });
};
