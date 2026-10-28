import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getHeatmapData, getTrackedPages } from "../lib/analytics.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const pages = await getTrackedPages(session.shop, days);
  const path = url.searchParams.get("path") || pages[0]?.path || "/";
  const heatmap = await getHeatmapData(session.shop, path, days);
  return { pages, path, days, heatmap };
};

// Classic thermal ramp for click density — a sequential multi-stop scale where
// hotter = more clicks; the legend below the stage names both ends.
const HEAT_STOPS = [
  [0.25, [12, 138, 112]],
  [0.55, [217, 166, 6]],
  [0.85, [217, 199, 6]],
  [1.0, [196, 61, 61]],
];

function drawHeat(canvas, clicks, width, height) {
  const ctx = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!clicks.length) return;

  // Pass 1: accumulate density into the alpha channel.
  const shadow = document.createElement("canvas");
  shadow.width = width;
  shadow.height = height;
  const sctx = shadow.getContext("2d");
  const r = Math.max(14, Math.round(width / 46));
  for (const c of clicks) {
    const x = c.xNorm * width;
    const y = c.yNorm * height;
    const g = sctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    sctx.fillStyle = g;
    sctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Pass 2: map density to the thermal ramp.
  const img = sctx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    if (a <= 0.02) continue;
    let rgb = HEAT_STOPS[0][1];
    for (const [stop, color] of HEAT_STOPS) {
      rgb = color;
      if (a <= stop) break;
    }
    out.data[i] = rgb[0];
    out.data[i + 1] = rgb[1];
    out.data[i + 2] = rgb[2];
    out.data[i + 3] = Math.min(230, Math.round(a * 290));
  }
  ctx.putImageData(out, 0, 0);
}

function drawScroll(canvas, scrollReach, width, height) {
  const ctx = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  const bandH = height / 10;
  for (let i = 0; i < 10; i++) {
    const pct = scrollReach[i + 1]?.pct ?? 0;
    const heat = pct / 100;
    ctx.fillStyle = `rgba(${Math.round(196 - heat * 184)}, ${Math.round(61 + heat * 77)}, ${Math.round(61 + heat * 51)}, 0.42)`;
    ctx.fillRect(0, i * bandH, width, bandH);
    ctx.fillStyle = "#0b1626";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText(`${pct}% reach ${ (i + 1) * 10 }%`, 12, i * bandH + 20);
  }
}

export default function Heatmaps() {
  const { pages, path, days, heatmap } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState("clicks");
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const snapHostRef = useRef(null);
  // undefined = loading, null = no snapshot available, object = ready to render
  const [snapshot, setSnapshot] = useState(undefined);
  const [snapError, setSnapError] = useState(false);
  const [snapReady, setSnapReady] = useState(false);
  // Measured size of the rebuilt snapshot document; the stage adopts its
  // aspect ratio so every page renders at a consistent, correct scale.
  const [snapDims, setSnapDims] = useState(null);
  const [stageW, setStageW] = useState(1000);

  // The snapshot is fetched separately (App Bridge adds the session token to
  // same-origin fetches) so the multi-megabyte DOM never bloats the document.
  useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);
    fetch(`/app/heatmaps/snapshot?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setSnapshot(d?.node ? d : null);
      })
      .catch((e) => {
        console.error("[heatmap] snapshot fetch failed:", e);
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Stage aspect ratio: the rebuilt snapshot's real document shape when we
  // have it; otherwise the median captured document shape from click data.
  const aspect = useMemo(() => {
    if (snapDims) return Math.min(12, Math.max(0.5, snapDims.h / snapDims.w));
    const ratios = heatmap.clicks
      .filter((c) => c.docW > 0 && c.docH > 0)
      .map((c) => c.docH / c.docW)
      .sort((a, b) => a - b);
    const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 2.2;
    return Math.min(6, Math.max(0.7, median));
  }, [snapDims, heatmap.clicks]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageH = Math.round(stageW * aspect);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (mode === "clicks") {
      drawHeat(canvasRef.current, heatmap.clicks, stageW, stageH);
    } else {
      drawScroll(canvasRef.current, heatmap.scrollReach, stageW, stageH);
    }
  }, [mode, heatmap, stageW, stageH]);

  // Rebuild the recorded DOM into a sandboxed iframe (scripts never run; the
  // sandbox attribute is set by rrweb-snapshot). Runs once per snapshot.
  useEffect(() => {
    const host = snapHostRef.current;
    if (!host || !snapshot?.node) return;
    let cancelled = false;
    let ro = null;
    const timers = [];
    setSnapError(false);
    setSnapReady(false);
    setSnapDims(null);
    (async () => {
      try {
        const { rebuildIntoSandboxedIframe, createCache, createMirror } = await import(
          "rrweb-snapshot"
        );
        if (cancelled) return;
        host.innerHTML = "";
        const { iframe } = rebuildIntoSandboxedIframe(snapshot.node, {
          root: host,
          cache: createCache(),
          mirror: createMirror(),
          iframeAttributes: { title: "Page snapshot", scrolling: "no" },
        });
        const width = snapshot.width || 1280;
        const vpH = snapshot.height || 900;
        iframe.style.width = `${width}px`;
        iframe.style.height = `${vpH}px`;
        const doc = iframe.contentDocument;
        if (doc) {
          // rrweb rebuilds <script> as <noscript>, and scripting is disabled
          // in the sandboxed iframe, so browsers would RENDER that content
          // ("SCRIPT_PLACEHOLDER", JSON blobs). rrweb's player hides it the
          // same way.
          const style = doc.createElement("style");
          style.textContent = "noscript{display:none!important}";
          (doc.head || doc.documentElement).appendChild(style);
          // Lazy images never intersect the viewport of a scaled-down
          // iframe, so they'd stay blank without this.
          doc
            .querySelectorAll("img[loading]")
            .forEach((img) => img.removeAttribute("loading"));
        }
        // The document reflows as its stylesheets and images arrive; keep
        // re-measuring so the stage settles on the true page height. Themes
        // that scroll an inner container clip html/body scrollHeight, so the
        // deepest bottom edge of laid-out content is measured too.
        const measure = () => {
          if (cancelled || !doc?.body) return;
          const win = iframe.contentWindow;
          let h = 0;
          doc.body.querySelectorAll("*").forEach((el) => {
            if (!el.getClientRects().length) return;
            if (win && win.getComputedStyle(el).position === "fixed") return;
            const b = el.getBoundingClientRect().bottom + (win?.scrollY || 0);
            if (b > h && b < 200000) h = b;
          });
          h = Math.ceil(Math.max(h, vpH));
          if (h > 100) {
            setSnapDims((prev) => (prev?.h === h ? prev : { w: width, h }));
          }
        };
        measure();
        for (const ms of [300, 1000, 2500, 5000]) timers.push(setTimeout(measure, ms));
        if (doc?.body && typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(measure);
          ro.observe(doc.body);
        }
        setSnapReady(true);
      } catch (e) {
        console.error("[heatmap] snapshot rebuild failed:", e);
        if (!cancelled) setSnapError(true);
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      ro?.disconnect();
    };
  }, [snapshot]);

  // Snapshot geometry: lay the iframe out at the recorded viewport width and
  // full measured height, then scale it to the stage. Because the stage's
  // aspect comes from the same measurement, background and stage stay in sync.
  const snapW = snapDims?.w || snapshot?.width || 1280;
  const snapScale = stageW / snapW;
  useEffect(() => {
    const iframe = snapHostRef.current?.querySelector("iframe");
    if (!iframe) return;
    iframe.style.width = `${snapW}px`;
    // Until the content is measured, hold the iframe at the recorded viewport
    // height so the measurement never chases the iframe's own size.
    iframe.style.height = `${snapDims ? snapDims.h : snapshot?.height || 900}px`;
    iframe.style.transform = `scale(${snapScale})`;
    iframe.style.transformOrigin = "top left";
    iframe.style.border = "none";
    iframe.style.pointerEvents = "none";
  }, [snapReady, snapDims, snapW, snapScale, snapshot]);

  const setParam = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setSearchParams(next);
  };

  return (
    <Page fullWidth>
      <div className="st-hero" style={{ padding: "20px 28px" }}>
        <h1>Heatmaps</h1>
        <p>Where visitors click, and how far they scroll, on every tracked page.</p>
      </div>

      <div className="st-rangebar">
        <select
          value={path}
          onChange={(e) => setParam({ path: e.target.value })}
          style={{
            padding: "7px 12px",
            borderRadius: 10,
            border: "1px solid var(--st-grid)",
            fontSize: 13,
            maxWidth: 360,
          }}
        >
          {pages.length === 0 ? <option value="/">/ (no data yet)</option> : null}
          {pages.map((p) => (
            <option key={p.path} value={p.path}>
              {p.path} — {p.views.toLocaleString()} views
            </option>
          ))}
        </select>
        {[
          [7, "7d"],
          [30, "30d"],
          [90, "90d"],
        ].map(([d, label]) => (
          <button
            key={d}
            className={`st-range-btn ${days === d ? "active" : ""}`}
            onClick={() => setParam({ days: String(d) })}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className={`st-range-btn ${mode === "clicks" ? "active" : ""}`}
          onClick={() => setMode("clicks")}
        >
          🔥 Clicks ({heatmap.clicks.length.toLocaleString()})
        </button>
        <button
          className={`st-range-btn ${mode === "scroll" ? "active" : ""}`}
          onClick={() => setMode("scroll")}
        >
          📜 Scroll depth
        </button>
      </div>

      {heatmap.clicks.length === 0 && heatmap.views === 0 ? (
        <div className="st-panel">
          <div className="st-empty">
            <div className="st-empty-icon">🔥</div>
            <h3>No interaction data for this page yet</h3>
            <p>Click and scroll data appears here as visitors browse your store.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="st-heatmap-stage" ref={stageRef} style={{ height: stageH, marginBottom: 10 }}>
            {snapshot?.node && !snapError ? (
              <div ref={snapHostRef} className="st-snap-host" style={{ height: stageH }} />
            ) : (
              <div className="st-snap-empty" style={{ height: stageH }}>
                <p>
                  {snapshot === undefined && !snapError
                    ? "Loading page snapshot…"
                    : "No page snapshot captured yet — the background appears after a recorded visitor session on this page."}
                </p>
              </div>
            )}
            <canvas ref={canvasRef} className="st-heatmap-overlay" style={{ width: "100%", height: stageH }} />
          </div>
          <div className="st-legend" style={{ marginBottom: 20 }}>
            {mode === "clicks" ? (
              <>
                <span className="st-legend-item">
                  <span className="st-swatch" style={{ background: "#0c8a70" }} /> fewer clicks
                </span>
                <span className="st-legend-item">
                  <span className="st-swatch" style={{ background: "#d9a606" }} /> more clicks
                </span>
                <span className="st-legend-item">
                  <span className="st-swatch" style={{ background: "#c43d3d" }} /> hottest
                </span>
                <span style={{ color: "var(--st-muted)" }}>
                  Based on {heatmap.clicks.length.toLocaleString()} clicks across {heatmap.views.toLocaleString()} views.
                  The background is a snapshot from the latest session recording of this page.
                </span>
              </>
            ) : (
              <span style={{ color: "var(--st-muted)" }}>
                Each band shows the share of visitors who scrolled at least that far down the page.
              </span>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
