// Production server.
//
// This replaces `react-router-serve` for one reason: it never calls
// `app.set("trust proxy", ...)`, and there is no flag to make it.
//
// Behind Coolify's Traefik, TLS is terminated at the proxy and the container is
// reached over plain HTTP. Without `trust proxy`, Express reports
// `req.protocol === "http"`, so @react-router/express builds
// `request.url = http://shoptrace.onkra.online/...`. The browser, meanwhile,
// sends `Origin: https://shoptrace.onkra.online` on every POST. React Router's
// `throwIfPotentialCSRFAttack` compares the two, sees http !== https, and
// rejects the request with 400 Bad Request.
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import path from "node:path";

const build = await import("./build/server/index.js");

// Hops between this process and the client. Traefik is exactly one, so the
// default trusts a single proxy rather than blanket-trusting X-Forwarded-*
// from anywhere. Override with TRUST_PROXY if another proxy (e.g. Cloudflare)
// is added in front.
const trustProxy = process.env.TRUST_PROXY ?? "1";

// If the proxy ever stops sending X-Forwarded-Proto, req.protocol silently
// reverts to http and every POST starts 400ing. Explicitly allowing this
// app's OWN host keeps actions working in that case without weakening the
// check against any other origin.
function allowedActionOrigins() {
  try {
    if (!process.env.SHOPIFY_APP_URL) return undefined;
    return [new URL(process.env.SHOPIFY_APP_URL).host];
  } catch {
    return undefined;
  }
}

const origins = allowedActionOrigins();
const getBuild = origins ? () => ({ ...build, allowedActionOrigins: origins }) : build;

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

app.use(compression());

// Fingerprinted assets can be cached forever; everything else in the build
// directory and in public/ gets the stock treatment.
app.use(
  path.posix.join(build.publicPath, "assets"),
  express.static(path.join(build.assetsBuildDirectory, "assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(build.publicPath, express.static(build.assetsBuildDirectory));
app.use(express.static("public", { maxAge: "1h" }));

app.use(morgan("tiny"));

app.all(
  "*",
  createRequestHandler({
    build: getBuild,
    mode: process.env.NODE_ENV,
  }),
);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const server = app.listen(port, host, () => {
  console.log(`[shoptrace] listening on http://${host}:${port}`);
  console.log(`[shoptrace] trust proxy: ${app.get("trust proxy")}`);
});

// Coolify's rolling update sends SIGTERM to the old container; closing the
// listener lets in-flight ingest requests finish instead of being cut off.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close(console.error));
}
