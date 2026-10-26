// Helpers shared by the storefront ingestion (app proxy) routes.
import prisma from "../db.server";

const MAX_STR = 500;

export function clampStr(v, max = MAX_STR) {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

export function clampInt(v, min, max, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function clampFloat(v, min, max, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Client-generated ids reach the database, so hold them to a strict shape.
export function isSafeId(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{8,40}$/.test(v);
}

// Minimal UA classification — enough for the device/browser/os breakdowns.
export function parseUserAgent(ua = "") {
  const s = ua.toLowerCase();
  let device = "desktop";
  if (/ipad|tablet/.test(s)) device = "tablet";
  else if (/mobi|iphone|android/.test(s)) device = "mobile";

  let browser = "Other";
  if (s.includes("edg/")) browser = "Edge";
  else if (s.includes("opr/") || s.includes("opera")) browser = "Opera";
  else if (s.includes("samsungbrowser")) browser = "Samsung Internet";
  else if (s.includes("firefox")) browser = "Firefox";
  else if (s.includes("chrome") || s.includes("crios")) browser = "Chrome";
  else if (s.includes("safari")) browser = "Safari";

  let os = "Other";
  if (s.includes("windows")) os = "Windows";
  else if (s.includes("iphone") || s.includes("ipad") || s.includes("ios")) os = "iOS";
  else if (s.includes("mac os")) os = "macOS";
  else if (s.includes("android")) os = "Android";
  else if (s.includes("linux")) os = "Linux";

  return { device, browser, os };
}

// IANA timezone → country, for the locations breakdown. The tracker sends the
// visitor's resolved timezone; this maps the common ones and falls back to the
// zone's region name, so every session lands in *some* bucket.
const TZ_COUNTRY = {
  "america/new_york": "United States", "america/chicago": "United States",
  "america/denver": "United States", "america/los_angeles": "United States",
  "america/phoenix": "United States", "america/anchorage": "United States",
  "pacific/honolulu": "United States", "america/detroit": "United States",
  "america/toronto": "Canada", "america/vancouver": "Canada",
  "america/edmonton": "Canada", "america/winnipeg": "Canada", "america/halifax": "Canada",
  "america/mexico_city": "Mexico", "america/monterrey": "Mexico", "america/tijuana": "Mexico",
  "america/sao_paulo": "Brazil", "america/bahia": "Brazil", "america/fortaleza": "Brazil",
  "america/manaus": "Brazil", "america/recife": "Brazil",
  "america/argentina/buenos_aires": "Argentina", "america/bogota": "Colombia",
  "america/lima": "Peru", "america/santiago": "Chile", "america/caracas": "Venezuela",
  "america/guayaquil": "Ecuador", "america/montevideo": "Uruguay",
  "europe/london": "United Kingdom", "europe/dublin": "Ireland",
  "europe/paris": "France", "europe/berlin": "Germany", "europe/madrid": "Spain",
  "europe/rome": "Italy", "europe/amsterdam": "Netherlands", "europe/brussels": "Belgium",
  "europe/zurich": "Switzerland", "europe/vienna": "Austria", "europe/lisbon": "Portugal",
  "europe/stockholm": "Sweden", "europe/oslo": "Norway", "europe/copenhagen": "Denmark",
  "europe/helsinki": "Finland", "europe/warsaw": "Poland", "europe/prague": "Czechia",
  "europe/budapest": "Hungary", "europe/bucharest": "Romania", "europe/sofia": "Bulgaria",
  "europe/athens": "Greece", "europe/istanbul": "Türkiye", "europe/kyiv": "Ukraine",
  "europe/moscow": "Russia", "europe/belgrade": "Serbia", "europe/zagreb": "Croatia",
  "europe/bratislava": "Slovakia", "europe/vilnius": "Lithuania", "europe/riga": "Latvia",
  "europe/tallinn": "Estonia",
  "asia/kolkata": "India", "asia/calcutta": "India",
  "asia/karachi": "Pakistan", "asia/dhaka": "Bangladesh", "asia/colombo": "Sri Lanka",
  "asia/kathmandu": "Nepal", "asia/shanghai": "China", "asia/hong_kong": "Hong Kong",
  "asia/taipei": "Taiwan", "asia/tokyo": "Japan", "asia/seoul": "South Korea",
  "asia/singapore": "Singapore", "asia/kuala_lumpur": "Malaysia",
  "asia/jakarta": "Indonesia", "asia/makassar": "Indonesia",
  "asia/bangkok": "Thailand", "asia/manila": "Philippines",
  "asia/ho_chi_minh": "Vietnam", "asia/saigon": "Vietnam",
  "asia/dubai": "United Arab Emirates", "asia/riyadh": "Saudi Arabia",
  "asia/qatar": "Qatar", "asia/kuwait": "Kuwait", "asia/bahrain": "Bahrain",
  "asia/jerusalem": "Israel", "asia/amman": "Jordan", "asia/beirut": "Lebanon",
  "asia/baghdad": "Iraq", "asia/tehran": "Iran",
  "africa/cairo": "Egypt", "africa/lagos": "Nigeria", "africa/nairobi": "Kenya",
  "africa/johannesburg": "South Africa", "africa/casablanca": "Morocco",
  "africa/algiers": "Algeria", "africa/accra": "Ghana", "africa/tunis": "Tunisia",
  "australia/sydney": "Australia", "australia/melbourne": "Australia",
  "australia/brisbane": "Australia", "australia/perth": "Australia",
  "australia/adelaide": "Australia", "pacific/auckland": "New Zealand",
};

export function timezoneToCountry(tz = "") {
  const key = String(tz).toLowerCase();
  if (TZ_COUNTRY[key]) return TZ_COUNTRY[key];
  const region = key.split("/")[0];
  const regions = {
    america: "Americas", europe: "Europe", asia: "Asia",
    africa: "Africa", australia: "Australia", pacific: "Pacific", atlantic: "Atlantic",
  };
  return regions[region] || "Unknown";
}

export async function getOrCreateSettings(shop) {
  return prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

// Purge visitor data past the retention window, at most once a day per shop,
// piggy-backed on ingest traffic so no scheduler is needed.
export async function maybeCleanup(shop) {
  const settings = await getOrCreateSettings(shop);
  const now = Date.now();
  if (
    settings.lastCleanupAt &&
    now - settings.lastCleanupAt.getTime() < 24 * 60 * 60 * 1000
  ) {
    return;
  }
  await prisma.shopSettings.update({
    where: { shop },
    data: { lastCleanupAt: new Date() },
  });
  const cutoff = new Date(now - settings.retentionDays * 24 * 60 * 60 * 1000);
  try {
    const old = await prisma.visitorSession.findMany({
      where: { shop, startedAt: { lt: cutoff } },
      select: { id: true },
      take: 5000,
    });
    if (old.length === 0) return;
    const ids = old.map((s) => s.id);
    await prisma.$transaction([
      prisma.recordingChunk.deleteMany({ where: { shop, sessionId: { in: ids } } }),
      prisma.clickEvent.deleteMany({ where: { shop, sessionId: { in: ids } } }),
      prisma.pageView.deleteMany({ where: { shop, sessionId: { in: ids } } }),
      prisma.visitorSession.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`[cleanup] ${shop}: purged ${ids.length} sessions older than ${settings.retentionDays}d`);
  } catch (e) {
    console.error(`[cleanup] ${shop} failed:`, e?.message || e);
  }
}

// Erase everything this app holds for a shop (uninstall / shop_redact).
export async function purgeShop(shop) {
  const tables = [
    ["session", prisma.session.deleteMany({ where: { shop } })],
    ["shopSettings", prisma.shopSettings.deleteMany({ where: { shop } })],
    ["visitorSession", prisma.visitorSession.deleteMany({ where: { shop } })],
    ["pageView", prisma.pageView.deleteMany({ where: { shop } })],
    ["clickEvent", prisma.clickEvent.deleteMany({ where: { shop } })],
    ["recordingChunk", prisma.recordingChunk.deleteMany({ where: { shop } })],
    ["survey", prisma.survey.deleteMany({ where: { shop } })],
    ["surveyResponse", prisma.surveyResponse.deleteMany({ where: { shop } })],
  ];
  const results = await Promise.allSettled(tables.map(([, p]) => p));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[PURGE] ${shop} ${tables[i][0]} failed:`, r.reason?.message || r.reason);
    }
  });
}
