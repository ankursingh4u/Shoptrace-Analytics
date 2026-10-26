// Shoptrace chart primitives — plain SVG, no chart library.
//
// Chrome follows the data-viz method: gridlines and axes are recessive, all
// text wears ink tokens (never series color), marks are thin with rounded
// ends, and every plotted chart ships a hover tooltip.
import { useMemo, useRef, useState } from "react";

const INK = "#0b1626";
const MUTED = "#898781";
const GRID = "#e7e6e0";

export const SERIES = {
  teal: "#0c8a70",
  violet: "#6e56cf",
  amber: "#d97706",
  rose: "#c43d6b",
};

export function StatTile({ label, value, sub, accent = "teal" }) {
  return (
    <div className={`st-tile st-accent-${accent}`}>
      <div className="st-tile-label">{label}</div>
      <div className="st-tile-value">{value}</div>
      {sub ? <div className="st-tile-sub">{sub}</div> : null}
    </div>
  );
}

// Single-series line chart with area wash and crosshair tooltip.
// data: [{ label, value }]
export function LineChart({ data, color = SERIES.teal, height = 220, formatValue }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 680;
  const H = height;
  const pad = { top: 16, right: 14, bottom: 26, left: 40 };

  const { points, max, ticks } = useMemo(() => {
    const values = data.map((d) => d.value);
    const rawMax = Math.max(1, ...values);
    const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const niceMax = Math.ceil(rawMax / mag) * mag;
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const pts = data.map((d, i) => ({
      x: pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
      y: pad.top + innerH - (d.value / niceMax) * innerH,
      ...d,
    }));
    const tickVals = [0, niceMax / 2, niceMax];
    return { points: pts, max: niceMax, ticks: tickVals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, H]);

  if (!data.length) return null;

  const innerH = H - pad.top - pad.bottom;
  const linePath = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${pad.top + innerH} L${points[0].x},${pad.top + innerH} Z`;
  const fmt = formatValue || ((v) => String(v));

  const onMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) / rect.width) * W;
    let best = null;
    for (const p of points) {
      if (!best || Math.abs(p.x - xSvg) < Math.abs(best.x - xSvg)) best = p;
    }
    if (best && wrapRef.current) {
      setHover({
        point: best,
        left: (best.x / W) * rect.width,
        top: (best.y / H) * rect.height,
      });
    }
  };

  // Label roughly 6 x-ticks so long ranges stay legible.
  const step = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="st-chart" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Line chart"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => {
          const y = pad.top + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill={MUTED}>
                {fmt(t)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill={color} opacity="0.09" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) =>
          i % step === 0 || i === points.length - 1 ? (
            <text key={i} x={p.x} y={H - 8} textAnchor="middle" fontSize="10.5" fill={MUTED}>
              {p.label}
            </text>
          ) : null,
        )}
        {hover ? (
          <g>
            <line
              x1={hover.point.x}
              x2={hover.point.x}
              y1={pad.top}
              y2={pad.top + innerH}
              stroke={INK}
              strokeWidth="1"
              opacity="0.25"
            />
            <circle cx={hover.point.x} cy={hover.point.y} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />
          </g>
        ) : null}
      </svg>
      {hover ? (
        <div className="st-tooltip" style={{ left: hover.left, top: hover.top }}>
          <span className="st-tt-label">{hover.point.label}</span>
          <br />
          <b>{fmt(hover.point.value)}</b>
        </div>
      ) : null}
    </div>
  );
}

// Donut for ≤4 categories (devices). Legend + per-slice hover tooltip;
// the center carries the total.
export function DonutChart({ data, colors = [SERIES.teal, SERIES.violet, SERIES.amber, SERIES.rose], size = 190 }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const R = 80;
  const rInner = 52;
  const C = size / 2;

  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = total ? d.value / total : 0;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    return { ...d, start, end, color: colors[i % colors.length], frac };
  });

  const arc = (start, end, r0, r1) => {
    // 2px surface gap between fills, expressed as a small angular inset.
    const inset = total && slices.length > 1 ? 0.02 : 0;
    const s = start + inset;
    const e = Math.max(s, end - inset);
    const large = e - s > Math.PI ? 1 : 0;
    const x0 = C + r1 * Math.cos(s), y0 = C + r1 * Math.sin(s);
    const x1 = C + r1 * Math.cos(e), y1 = C + r1 * Math.sin(e);
    const x2 = C + r0 * Math.cos(e), y2 = C + r0 * Math.sin(e);
    const x3 = C + r0 * Math.cos(s), y3 = C + r0 * Math.sin(s);
    return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div className="st-chart" style={{ width: size, flex: "none" }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Breakdown donut chart">
          {slices.map((s, i) =>
            s.frac > 0 ? (
              <path
                key={i}
                d={arc(s.start, s.end, rInner, R)}
                fill={s.color}
                opacity={hover === null || hover === i ? 1 : 0.35}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ) : null,
          )}
          <text x={C} y={C - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill={INK}>
            {hover !== null ? slices[hover].value.toLocaleString() : total.toLocaleString()}
          </text>
          <text x={C} y={C + 15} textAnchor="middle" fontSize="10.5" fill={MUTED}>
            {hover !== null ? slices[hover].label : "total"}
          </text>
        </svg>
      </div>
      <div className="st-legend" style={{ flexDirection: "column", gap: 8, marginTop: 0 }}>
        {slices.map((s, i) => (
          <span className="st-legend-item" key={i}>
            <span className="st-swatch" style={{ background: s.color }} />
            {s.label}
            <b style={{ color: INK }}>{total ? Math.round((s.value / total) * 100) : 0}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// Labeled horizontal bar list (top pages, referrers, countries). The value is
// printed on every row, which is the direct-label relief for bar color.
export function BarList({ items, color = SERIES.teal, formatValue }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const fmt = formatValue || ((v) => v.toLocaleString());
  if (!items.length) {
    return <p style={{ color: "var(--st-muted)", fontSize: 13, margin: 0 }}>No data yet.</p>;
  }
  return (
    <div className="st-barlist">
      {items.map((item, i) => (
        <div className="st-barlist-row" key={i} title={item.label}>
          <span className="st-barlist-label">{item.label}</span>
          <span className="st-barlist-value">{fmt(item.value)}</span>
          <div className="st-barlist-track">
            <div
              className="st-barlist-fill"
              style={{ width: `${(item.value / max) * 100}%`, "--st-fill": color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Funnel({ stages }) {
  const max = Math.max(1, stages[0]?.value || 0);
  return (
    <div className="st-funnel">
      {stages.map((s, i) => (
        <div className="st-funnel-stage" key={i}>
          <span className="st-funnel-name">{s.label}</span>
          <div className="st-funnel-track">
            <div className="st-funnel-fill" style={{ width: `${(s.value / max) * 100}%` }} />
          </div>
          <span className="st-funnel-count">
            {s.value.toLocaleString()}
            <span className="st-funnel-pct">{max ? Math.round((s.value / max) * 100) : 0}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function fmtDuration(totalSec) {
  const sec = Math.max(0, Math.round(totalSec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
