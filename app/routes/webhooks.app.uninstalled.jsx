// app/uninstalled + the three mandatory GDPR compliance topics.
//
// shopify.app.toml points `app/uninstalled` AND the compliance topics
// (`customers/redact`, `customers/data_request`, `shop/redact`) at this one
// URI, so this handler MUST branch on the topic.
//
// What this app stores per shop (see prisma/schema.prisma): Shopify sessions,
// tracker settings, anonymous visitor sessions/pageviews/clicks, gzipped rrweb
// recordings, surveys and survey responses. Visitors are identified only by a
// random id the tracker mints — no name, email, customer id or IP is stored —
// so a customers/redact request has no row it could be matched against.
import { authenticate } from "../shopify.server";
import { purgeShop } from "../lib/ingest.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    // The merchant removed the app. Credentials are now useless, so drop them
    // along with all tracked data.
    case "APP_UNINSTALLED":
      if (session) await purgeShop(shop);
      break;

    // Shop-level erasure request (sent 48h after an uninstall, and on demand).
    // Unconditional — by this point there is no session left to gate on.
    case "SHOP_REDACT":
      await purgeShop(shop);
      break;

    // Visitor data is keyed by random tracker ids and carries no customer
    // identity, so there is nothing to look up for a specific customer.
    // Acknowledging is the correct, complete response.
    case "CUSTOMERS_REDACT":
    case "CUSTOMERS_DATA_REQUEST":
      console.log(`[COMPLIANCE] ${topic} for ${shop}: no identifiable customer data is stored`);
      break;

    default:
      console.log(`[WEBHOOK] Unhandled topic ${topic} for ${shop}`);
  }

  return new Response();
};
