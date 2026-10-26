// POST /apps/shoptrace/collect (proxied to /proxy/collect)
//
// Batched behavioural events from the storefront tracker: pageviews, pageview
// endings (time on page + scroll depth), clicks and funnel milestones. The app
// proxy signature authenticates the shop; everything else in the payload is
// untrusted client input and is clamped before it reaches the database.
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  clampFloat,
  clampInt,
  clampStr,
  isSafeId,
  maybeCleanup,
  parseUserAgent,
  timezoneToCountry,
} from "../lib/ingest.server";

const MAX_BODY_BYTES = 512 * 1024;

async function readJson(request) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY_BYTES) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const body = await readJson(request);
  if (!shop || !body || !isSafeId(body.sid) || !isSafeId(body.vid)) {
    return new Response(null, { status: 400 });
  }

  const sid = body.sid;
  const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
  const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
  const ua = parseUserAgent(request.headers.get("user-agent") || "");

  const now = new Date();
  const pageviews = [];
  const pageviewEnds = [];
  const clicks = [];
  const flags = {};
  let exitPage = "";

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    switch (ev.t) {
      case "pv":
        if (isSafeId(ev.id)) {
          pageviews.push({
            id: ev.id,
            shop,
            sessionId: sid,
            path: clampStr(ev.path),
            title: clampStr(ev.title, 200),
          });
          exitPage = clampStr(ev.path);
        }
        break;
      case "pv_end":
        if (isSafeId(ev.id)) {
          pageviewEnds.push({
            id: ev.id,
            timeOnPage: clampInt(ev.sec, 0, 7200),
            maxScrollPct: clampInt(ev.scroll, 0, 100),
          });
        }
        break;
      case "click":
        clicks.push({
          shop,
          sessionId: sid,
          path: clampStr(ev.path),
          xNorm: clampFloat(ev.x, 0, 1),
          yNorm: clampFloat(ev.y, 0, 1),
          docW: clampInt(ev.dw, 0, 20000),
          docH: clampInt(ev.dh, 0, 200000),
          selector: clampStr(ev.sel, 200),
        });
        break;
      case "product_view":
        flags.viewedProduct = true;
        break;
      case "cart_add":
        flags.addedToCart = true;
        break;
      case "checkout":
        flags.reachedCheckout = true;
        break;
      default:
        break;
    }
  }

  const existing = await prisma.visitorSession.findUnique({ where: { id: sid } });
  if (existing && existing.shop !== shop) {
    // A session id can only ever belong to the shop that created it.
    return new Response(null, { status: 403 });
  }

  if (!existing) {
    // Upsert instead of create: two batches from the same fresh session can
    // race past the findUnique above, and the loser must not 500.
    await prisma.visitorSession.upsert({
      where: { id: sid },
      update: {
        lastSeenAt: now,
        pageCount: { increment: pageviews.length },
        ...(exitPage ? { exitPage } : {}),
        ...flags,
      },
      create: {
        id: sid,
        shop,
        visitorId: body.vid,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        language: clampStr(meta.lang, 20),
        country: timezoneToCountry(clampStr(meta.tz, 60)),
        referrer: clampStr(meta.ref),
        landingPage: clampStr(meta.landing),
        screenW: clampInt(meta.sw, 0, 20000),
        screenH: clampInt(meta.sh, 0, 20000),
        exitPage,
        pageCount: pageviews.length,
        ...flags,
      },
    });
  } else {
    const durationSec = Math.max(
      0,
      Math.round((now.getTime() - existing.startedAt.getTime()) / 1000),
    );
    await prisma.visitorSession.update({
      where: { id: sid },
      data: {
        lastSeenAt: now,
        durationSec: Math.min(durationSec, 6 * 3600),
        pageCount: { increment: pageviews.length },
        ...(exitPage ? { exitPage } : {}),
        ...flags,
      },
    });
  }

  if (pageviews.length) {
    await prisma.pageView.createMany({ data: pageviews, skipDuplicates: true });
  }
  for (const end of pageviewEnds.slice(0, 20)) {
    await prisma.pageView.updateMany({
      where: { id: end.id, shop, sessionId: sid },
      data: { timeOnPage: end.timeOnPage, maxScrollPct: end.maxScrollPct },
    });
  }
  if (clicks.length) {
    await prisma.clickEvent.createMany({ data: clicks.slice(0, 50) });
  }

  maybeCleanup(shop).catch(() => {});

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

export const loader = () => new Response(null, { status: 405 });
