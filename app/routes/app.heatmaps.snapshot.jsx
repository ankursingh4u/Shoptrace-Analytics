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
  if (!snapshot) {
    return Response.json(null, { headers: { "Cache-Control": "private, max-age=60" } });
  }
  // Bake viewport units (vh/svh/dvh/lvh/vmin/vmax) to the recorded viewport.
  // The snapshot renders in an iframe as tall as the whole document, where
  // 100vh would otherwise resolve to the full page height and blow up
  // full-viewport sections (and feed back into the height measurement).
  // Done on the serialized JSON so it covers style attributes, inlined
  // stylesheets (_cssText), and split CSS chunks alike.
  const vpW = snapshot.width || 1280;
  const vpH = snapshot.height || 900;
  const baked = JSON.stringify(snapshot).replace(
    /(-?\d*\.?\d+)(?:s|l|d)?v(h|min|max)\b/g,
    (m, n, unit) => {
      const base =
        unit === "h" ? vpH : unit === "min" ? Math.min(vpW, vpH) : Math.max(vpW, vpH);
      return `${(parseFloat(n) / 100) * base}px`;
    },
  );
  return new Response(baked, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=60",
    },
  });
};
