// POST /apps/shoptrace/survey (proxied to /proxy/survey)
//
// One survey answer from the storefront widget.
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { clampStr, isSafeId } from "../lib/ingest.server";

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const answer = clampStr(body?.answer, 2000).trim();
  if (!shop || typeof body?.surveyId !== "string" || !answer) {
    return new Response(null, { status: 400 });
  }

  // The survey must belong to the signing shop — the id alone is not enough.
  const survey = await prisma.survey.findFirst({
    where: { id: clampStr(body.surveyId, 40), shop },
    select: { id: true },
  });
  if (!survey) return new Response(null, { status: 404 });

  await prisma.surveyResponse.create({
    data: {
      shop,
      surveyId: survey.id,
      sessionId: isSafeId(body.sid) ? body.sid : "",
      answer,
    },
  });

  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

export const loader = () => new Response(null, { status: 405 });
