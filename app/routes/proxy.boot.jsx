// GET /apps/shoptrace/boot (proxied to /proxy/boot)
//
// First call the storefront tracker makes: returns the shop's tracker
// configuration and any active surveys. Signature-verified by Shopify's app
// proxy, so `shop` in the query string is trustworthy.
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSettings } from "../lib/ingest.server";

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  if (!shop) return Response.json({ enabled: false }, { status: 400 });

  const settings = await getOrCreateSettings(shop);
  const surveys = settings.trackingEnabled
    ? await prisma.survey.findMany({
        where: { shop, status: "active" },
        select: {
          id: true,
          question: true,
          type: true,
          options: true,
          triggerDelay: true,
          pagePattern: true,
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      })
    : [];

  return Response.json(
    {
      enabled: settings.trackingEnabled,
      recording: {
        enabled: settings.recordingEnabled,
        sample: settings.recordingSampleRate,
        maxSeconds: settings.recordingMaxSeconds,
      },
      excludePaths: settings.excludePaths
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      surveys: surveys.map((s) => ({
        id: s.id,
        question: s.question,
        type: s.type,
        options: JSON.parse(s.options || "[]"),
        delay: s.triggerDelay,
        pages: s.pagePattern,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};
