// Aggregations behind the admin dashboard.
import { gunzipSync } from "node:zlib";
import prisma from "../db.server";

export function rangeStart(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function dayLabel(key) {
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function getOverview(shop, days) {
  const since = rangeStart(days);
  const where = { shop, startedAt: { gte: since } };

  const [sessions, totals, pageviews, recordings] = await Promise.all([
    prisma.visitorSession.findMany({
      where,
      select: {
        startedAt: true,
        visitorId: true,
        durationSec: true,
        device: true,
        browser: true,
        country: true,
        referrer: true,
        viewedProduct: true,
        addedToCart: true,
        reachedCheckout: true,
      },
    }),
    prisma.visitorSession.aggregate({ where, _sum: { pageCount: true } }),
    prisma.pageView.groupBy({
      by: ["path"],
      where: { shop, enteredAt: { gte: since } },
      _count: { path: true },
      orderBy: { _count: { path: "desc" } },
      take: 8,
    }),
    prisma.visitorSession.count({ where: { ...where, hasRecording: true } }),
  ]);

  // Sessions per day, zero-filled across the whole range.
  const perDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    perDay.set(dayKey(d), 0);
  }
  const uniqueVisitors = new Set();
  const devices = new Map();
  const browsers = new Map();
  const countries = new Map();
  const referrers = new Map();
  let totalDuration = 0;
  let viewedProduct = 0;
  let addedToCart = 0;
  let reachedCheckout = 0;

  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    if (perDay.has(key)) perDay.set(key, perDay.get(key) + 1);
    uniqueVisitors.add(s.visitorId);
    devices.set(s.device, (devices.get(s.device) || 0) + 1);
    browsers.set(s.browser || "Other", (browsers.get(s.browser || "Other") || 0) + 1);
    countries.set(s.country || "Unknown", (countries.get(s.country || "Unknown") || 0) + 1);
    totalDuration += s.durationSec;
    if (s.viewedProduct) viewedProduct++;
    if (s.addedToCart) addedToCart++;
    if (s.reachedCheckout) reachedCheckout++;
    if (s.referrer) {
      let host = "Direct";
      try {
        host = new URL(s.referrer).hostname.replace(/^www\./, "");
      } catch {
        host = "Direct";
      }
      if (host && !host.endsWith(".myshopify.com") && host !== shop.replace(".myshopify.com", "")) {
        referrers.set(host, (referrers.get(host) || 0) + 1);
      }
    } else {
      referrers.set("Direct", (referrers.get("Direct") || 0) + 1);
    }
  }

  const toSorted = (map, limit = 6) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label, value]) => ({ label, value }));

  return {
    totals: {
      sessions: sessions.length,
      visitors: uniqueVisitors.size,
      pageviews: totals._sum.pageCount || 0,
      avgDuration: sessions.length ? totalDuration / sessions.length : 0,
      recordings,
    },
    sessionsPerDay: [...perDay.entries()].map(([key, value]) => ({
      label: dayLabel(key),
      value,
    })),
    topPages: pageviews.map((p) => ({ label: p.path || "/", value: p._count.path })),
    devices: toSorted(devices, 4),
    browsers: toSorted(browsers, 6),
    countries: toSorted(countries, 6),
    referrers: toSorted(referrers, 6),
    funnel: [
      { label: "Visited store", value: sessions.length },
      { label: "Viewed product", value: viewedProduct },
      { label: "Added to cart", value: addedToCart },
      { label: "Reached checkout", value: reachedCheckout },
    ],
  };
}

export async function getRecordedSessions(shop, days, page = 1, pageSize = 25) {
  const since = rangeStart(days);
  const where = { shop, startedAt: { gte: since }, hasRecording: true };
  const [rows, total] = await Promise.all([
    prisma.visitorSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.visitorSession.count({ where }),
  ]);
  return { rows, total };
}

export async function getHeatmapData(shop, path, days) {
  const since = rangeStart(days);
  const [clicks, scrollAgg] = await Promise.all([
    prisma.clickEvent.findMany({
      where: { shop, path, createdAt: { gte: since } },
      select: { xNorm: true, yNorm: true, docW: true, docH: true, selector: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.pageView.findMany({
      where: { shop, path, enteredAt: { gte: since } },
      select: { maxScrollPct: true },
      take: 5000,
    }),
  ]);

  // Scroll reach: share of pageviews that scrolled at least X% deep.
  const reach = new Array(11).fill(0);
  for (const pv of scrollAgg) {
    const bucket = Math.min(10, Math.floor(pv.maxScrollPct / 10));
    for (let i = 0; i <= bucket; i++) reach[i]++;
  }
  const views = scrollAgg.length || 1;

  return {
    clicks,
    views: scrollAgg.length,
    scrollReach: reach.map((count, i) => ({
      depth: i * 10,
      pct: Math.round((count / views) * 100),
    })),
  };
}

// rrweb event types, inlined so the server never imports the rrweb bundle.
const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_META = 4;

// The storefront blocks framing (X-Frame-Options: DENY on password pages and
// many themes), so the heatmap background is rebuilt from the most recent
// rrweb full snapshot of the page instead of an <iframe src> of the live site.
export async function getPageSnapshot(shop, path) {
  const pageViews = await prisma.pageView.findMany({
    where: { shop, path },
    orderBy: { enteredAt: "desc" },
    select: { sessionId: true },
    take: 40,
  });
  const candidates = [...new Set(pageViews.map((pv) => pv.sessionId))].slice(0, 5);
  if (!candidates.length) return null;

  const recorded = await prisma.visitorSession.findMany({
    where: { id: { in: candidates }, shop, hasRecording: true },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  for (const s of recorded) {
    const chunks = await prisma.recordingChunk.findMany({
      where: { sessionId: s.id, shop },
      orderBy: [{ seq: "asc" }, { createdAt: "asc" }],
    });
    const events = [];
    for (const chunk of chunks) {
      try {
        const parsed = JSON.parse(gunzipSync(Buffer.from(chunk.data)).toString("utf8"));
        if (Array.isArray(parsed)) events.push(...parsed);
      } catch {
        // Skip corrupt chunks; the replay page logs these already.
      }
    }
    events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // A Meta event announces the page (href + viewport); the FullSnapshot that
    // follows it is the DOM of that page. Take the last matching pair so the
    // background reflects the newest capture in the session.
    let meta = null;
    let found = null;
    for (const evt of events) {
      if (evt.type === RRWEB_META) {
        let evtPath = null;
        try {
          evtPath = new URL(evt.data?.href || "").pathname;
        } catch {
          evtPath = null;
        }
        meta = evtPath === path ? evt : null;
      } else if (evt.type === RRWEB_FULL_SNAPSHOT && meta && evt.data?.node) {
        found = {
          node: evt.data.node,
          width: meta.data?.width || 0,
          height: meta.data?.height || 0,
        };
      }
    }
    if (found) return found;
  }
  return null;
}

export async function getTrackedPages(shop, days, limit = 50) {
  const since = rangeStart(days);
  const pages = await prisma.pageView.groupBy({
    by: ["path"],
    where: { shop, enteredAt: { gte: since } },
    _count: { path: true },
    orderBy: { _count: { path: "desc" } },
    take: limit,
  });
  return pages.map((p) => ({ path: p.path || "/", views: p._count.path }));
}
