import { useEffect, useRef, useState } from "react";
import { Link, useLoaderData } from "react-router";
import { Page } from "@shopify/polaris";
import { gunzipSync } from "node:zlib";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fmtDuration } from "../components/charts";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const visitorSession = await prisma.visitorSession.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!visitorSession) {
    throw new Response("Recording not found", { status: 404 });
  }
  const chunks = await prisma.recordingChunk.findMany({
    where: { sessionId: visitorSession.id, shop: session.shop },
    orderBy: [{ seq: "asc" }, { createdAt: "asc" }],
  });

  const events = [];
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(gunzipSync(Buffer.from(chunk.data)).toString("utf8"));
      if (Array.isArray(parsed)) events.push(...parsed);
    } catch (e) {
      console.error(`[replay] bad chunk ${chunk.id}:`, e?.message);
    }
  }
  events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  return {
    meta: {
      id: visitorSession.id,
      startedAt: visitorSession.startedAt,
      device: visitorSession.device,
      browser: visitorSession.browser,
      os: visitorSession.os,
      country: visitorSession.country,
      pageCount: visitorSession.pageCount,
      durationSec: visitorSession.durationSec,
      landingPage: visitorSession.landingPage,
    },
    events,
  };
};

export default function RecordingReplay() {
  const { meta, events } = useLoaderData();
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function mount() {
      if (!containerRef.current || events.length < 2) return;
      try {
        const [{ default: RrwebPlayer }] = await Promise.all([
          import("rrweb-player"),
          import("rrweb-player/dist/style.css"),
        ]);
        if (cancelled) return;
        containerRef.current.innerHTML = "";
        const width = Math.min(1024, containerRef.current.clientWidth - 8);
        playerRef.current = new RrwebPlayer({
          target: containerRef.current,
          props: {
            events,
            width,
            height: Math.round((width * 9) / 16),
            autoPlay: false,
            skipInactive: true,
            showController: true,
          },
        });
      } catch (e) {
        console.error("[replay] player failed:", e);
        if (!cancelled) setError(String(e?.message || e));
      }
    }
    mount();
    return () => {
      cancelled = true;
      try {
        playerRef.current?.pause?.();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page fullWidth>
      <div className="st-rangebar">
        <Link to="/app/recordings" className="st-btn st-btn-ghost">
          ← All recordings
        </Link>
        <span className="st-pill st-pill-teal">
          {new Date(meta.startedAt).toLocaleString()}
        </span>
        <span className="st-pill st-pill-gray">
          {meta.device} · {meta.browser} · {meta.os}
        </span>
        <span className="st-pill st-pill-gray">{meta.country || "Unknown region"}</span>
        <span className="st-pill st-pill-violet">
          {meta.pageCount} pages · {fmtDuration(meta.durationSec)}
        </span>
      </div>

      {events.length < 2 ? (
        <div className="st-panel">
          <div className="st-empty">
            <div className="st-empty-icon">🎬</div>
            <h3>This recording is empty</h3>
            <p>The session ended before enough replay data was captured.</p>
          </div>
        </div>
      ) : (
        <div className="st-player-wrap" style={{ marginBottom: 20 }}>
          {error ? (
            <p style={{ color: "#fff", margin: 8 }}>Replay failed to load: {error}</p>
          ) : null}
          <div ref={containerRef} />
        </div>
      )}
    </Page>
  );
}
