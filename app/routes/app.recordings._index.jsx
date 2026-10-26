import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getRecordedSessions } from "../lib/analytics.server";
import { fmtDuration } from "../components/charts";

const PAGE_SIZE = 25;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const { rows, total } = await getRecordedSessions(session.shop, days, page, PAGE_SIZE);
  return {
    days,
    page,
    total,
    rows: rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      device: r.device,
      browser: r.browser,
      country: r.country,
      pageCount: r.pageCount,
      durationSec: r.durationSec,
      landingPage: r.landingPage,
      addedToCart: r.addedToCart,
      reachedCheckout: r.reachedCheckout,
    })),
  };
};

const DEVICE_ICON = { desktop: "🖥", mobile: "📱", tablet: "💻" };

export default function Recordings() {
  const { rows, days, page, total } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Page fullWidth>
      <div className="st-hero" style={{ padding: "20px 28px" }}>
        <h1>Session recordings</h1>
        <p>Watch real visitor sessions replayed exactly as they happened.</p>
      </div>

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
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--st-muted)" }}>
          {total.toLocaleString()} recording{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="st-panel">
        {rows.length === 0 ? (
          <div className="st-empty">
            <div className="st-empty-icon">🎬</div>
            <h3>No recordings in this range</h3>
            <p>
              Recordings are captured automatically while the tracker app embed
              is enabled and “Session recordings” is on in Settings.
            </p>
          </div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Device</th>
                <th>Region</th>
                <th>Landing page</th>
                <th>Pages</th>
                <th>Duration</th>
                <th>Milestones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="st-row-link"
                  onClick={() => navigate(`/app/recordings/${r.id}`)}
                >
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>
                    {DEVICE_ICON[r.device] || "🖥"} {r.device} · {r.browser}
                  </td>
                  <td>{r.country || "—"}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.landingPage || "/"}
                  </td>
                  <td>{r.pageCount}</td>
                  <td>{fmtDuration(r.durationSec)}</td>
                  <td>
                    {r.reachedCheckout ? (
                      <span className="st-pill st-pill-teal">Checkout</span>
                    ) : r.addedToCart ? (
                      <span className="st-pill st-pill-violet">Added to cart</span>
                    ) : (
                      <span className="st-pill st-pill-gray">Browsed</span>
                    )}
                  </td>
                  <td>
                    <span className="st-btn st-btn-ghost" style={{ padding: "5px 12px" }}>
                      ▶ Watch
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            <button
              className="st-range-btn"
              disabled={page <= 1}
              onClick={() => setSearchParams({ days: String(days), page: String(page - 1) })}
            >
              ← Prev
            </button>
            <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--st-muted)" }}>
              Page {page} of {pages}
            </span>
            <button
              className="st-range-btn"
              disabled={page >= pages}
              onClick={() => setSearchParams({ days: String(days), page: String(page + 1) })}
            >
              Next →
            </button>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
