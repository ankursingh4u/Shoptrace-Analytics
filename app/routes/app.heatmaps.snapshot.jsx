// GET /app/heatmaps/snapshot?path=/...
//
// Resource route serving the rrweb page snapshot for the heatmap background.
// Kept out of the heatmaps loader on purpose: the serialized DOM runs to
// megabytes, which would bloat the SSR document and stall first paint.
import { authenticate } from "../shopify.server";
import { getPageSnapshot } from "../lib/analytics.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "/";
  const snapshot = await getPageSnapshot(session.shop, path);
  return Response.json(snapshot, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
};
