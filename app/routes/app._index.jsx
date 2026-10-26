import { useLoaderData, useSearchParams } from "react-router";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getOverview } from "../lib/analytics.server";
import { getOrCreateSettings } from "../lib/ingest.server";
import {
  BarList,
  DonutChart,
  Funnel,
  LineChart,
  SERIES,
  StatTile,
  fmtDuration,
} from "../components/charts";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 7;
  const [overview, settings] = await Promise.all([
    getOverview(session.shop, days),
    getOrCreateSettings(session.shop),
  ]);
  return { overview, days, shop: session.shop, trackingEnabled: settings.trackingEnabled };
};

function RangeBar({ days }) {
  const [, setSearchParams] = useSearchParams();
  return (
    <div className="st-rangebar">
      {[
        [7, "Last 7 days"],
        [30, "Last 30 days"],
        [90, "Last 90 days"],
      ].map(([d, label]) => (
        <button
          key={d}
          className={`st-range-btn ${days === d ? "active" : ""}`}
          onClick={() => setSearchParams({ days: String(d) })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { overview, days, shop, trackingEnabled } = useLoaderData();
  const { totals } = overview;
  const noData = totals.sessions === 0;

  return (
    <Page fullWidth>
      <div className="st-hero">
        <span className="st-hero-badge">◉ Shoptrace Analytics</span>
        <h1>See exactly how visitors use your store</h1>
        <p>
          Session recordings, click heatmaps, conversion funnels and on-site
          surveys — all captured automatically once the tracker is enabled in
          your theme.
        </p>
      </div>

      <RangeBar days={days} />

      {noData ? (
        <div className="st-panel">
          <div className="st-empty">
            <div className="st-empty-icon">📡</div>
            <h3>{trackingEnabled ? "Waiting for your first visitor" : "Tracking is turned off"}</h3>
            <p>
              Enable the <b>Shoptrace Tracker</b> app embed in your theme:
              Online Store → Themes → Customize → App embeds → turn on
              “Shoptrace Tracker”, then save. Data appears here within a minute
              of the first visit on <b>{shop.replace(".myshopify.com", "")}</b>.
            </p>
          </div>
        </div>
      ) : null}

      <div className="st-tiles">
        <StatTile label="Sessions" value={totals.sessions.toLocaleString()} accent="teal" />
        <StatTile label="Unique visitors" value={totals.visitors.toLocaleString()} accent="violet" />
        <StatTile label="Page views" value={totals.pageviews.toLocaleString()} accent="amber" />
        <StatTile label="Avg. session" value={fmtDuration(totals.avgDuration)} accent="rose" />
        <StatTile label="Recordings" value={totals.recordings.toLocaleString()} accent="teal" />
      </div>

      <div className="st-panel">
        <h3 className="st-panel-title">Sessions over time</h3>
        <p className="st-panel-sub">Storefront sessions per day, last {days} days</p>
        <LineChart data={overview.sessionsPerDay} color={SERIES.teal} />
      </div>

      <div className="st-grid-2" style={{ marginTop: 12 }}>
        <div className="st-panel">
          <h3 className="st-panel-title">Conversion funnel</h3>
          <p className="st-panel-sub">How far sessions progressed toward checkout</p>
          <Funnel stages={overview.funnel} />
        </div>
        <div className="st-panel">
          <h3 className="st-panel-title">Devices</h3>
          <p className="st-panel-sub">Sessions by device type</p>
          <DonutChart data={overview.devices} />
        </div>
      </div>

      <div className="st-grid-2" style={{ marginTop: 12 }}>
        <div className="st-panel">
          <h3 className="st-panel-title">Top pages</h3>
          <p className="st-panel-sub">Most viewed pages in range</p>
          <BarList items={overview.topPages} color={SERIES.teal} />
        </div>
        <div className="st-panel">
          <h3 className="st-panel-title">Traffic sources</h3>
          <p className="st-panel-sub">Referrer domains of incoming sessions</p>
          <BarList items={overview.referrers} color={SERIES.violet} />
        </div>
      </div>

      <div className="st-grid-2" style={{ marginTop: 12, marginBottom: 20 }}>
        <div className="st-panel">
          <h3 className="st-panel-title">Locations</h3>
          <p className="st-panel-sub">Approximate visitor regions (from timezone)</p>
          <BarList items={overview.countries} color={SERIES.amber} />
        </div>
        <div className="st-panel">
          <h3 className="st-panel-title">Browsers</h3>
          <p className="st-panel-sub">Sessions by browser</p>
          <BarList items={overview.browsers} color={SERIES.rose} />
        </div>
      </div>
    </Page>
  );
}
