// POST /apps/shoptrace/record (proxied to /proxy/record)
//
// A batch of rrweb events for one session. Stored gzipped; the replay page
// decompresses and stitches chunks back together in `seq` order.
import { gzipSync } from "node:zlib";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { clampInt, getOrCreateSettings, isSafeId } from "../lib/ingest.server";

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS_PER_SESSION = 150;

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  if (!shop) return new Response(null, { status: 400 });

  const raw = await request.text();
  if (!raw || raw.length > MAX_CHUNK_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!isSafeId(body.sid) || !Array.isArray(body.events) || body.events.length === 0) {
    return new Response(null, { status: 400 });
  }

  const settings = await getOrCreateSettings(shop);
  if (!settings.trackingEnabled || !settings.recordingEnabled) {
    return new Response(null, { status: 204 });
  }

  const session = await prisma.visitorSession.findUnique({
    where: { id: body.sid },
    select: { shop: true },
  });
  if (!session || session.shop !== shop) {
    // Recording chunks only attach to a session this shop already created
    // through /collect.
    return new Response(null, { status: 403 });
  }

  const count = await prisma.recordingChunk.count({ where: { sessionId: body.sid } });
  if (count >= MAX_CHUNKS_PER_SESSION) {
    return new Response(null, { status: 204 });
  }

  await prisma.recordingChunk.create({
    data: {
      shop,
      sessionId: body.sid,
      seq: clampInt(body.seq, 0, 100000),
      data: gzipSync(JSON.stringify(body.events)),
    },
  });
  await prisma.visitorSession.update({
    where: { id: body.sid },
    data: { hasRecording: true },
  });

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

export const loader = () => new Response(null, { status: 405 });
