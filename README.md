# Shoptrace Analytics

Visitor analytics for Shopify storefronts: session recordings, click & scroll
heatmaps, conversion funnels, traffic breakdowns and on-site surveys — in the
style of Lucky Orange, rebuilt from scratch with its own design system
(deep-space navy + emerald teal + violet aurora).

## Architecture

- **Admin app** — embedded Shopify app (React Router 7 + Polaris + custom
  Shoptrace brand layer), served by Express behind Coolify/Traefik.
- **Storefront tracker** — theme app extension (`extensions/shoptrace-tracker`)
  providing an **app embed** (`Shoptrace Tracker`). It captures pageviews,
  clicks, scroll depth, cart/checkout milestones, rrweb session recordings
  (inputs masked) and renders survey widgets.
- **Ingestion** — all storefront data flows through the **Shopify app proxy**
  (`/apps/shoptrace/*` → `https://shoptrace.onkra.online/proxy/*`), so requests
  are same-origin on the shop and signed by Shopify (`authenticate.public.appProxy`).
- **Database** — PostgreSQL via Prisma (`prisma/schema.prisma`). Recordings are
  stored as gzipped rrweb event batches. Data auto-purges after the configured
  retention window and fully on uninstall / `shop/redact`.

## Routes

| Route | Purpose |
| --- | --- |
| `/app` | Analytics dashboard (sessions, visitors, funnel, devices, pages, sources, locations) |
| `/app/recordings`, `/app/recordings/:id` | Session replay list + rrweb player |
| `/app/heatmaps` | Click density + scroll-depth heatmaps over a live page preview |
| `/app/surveys`, `/app/surveys/:id` | Survey builder + response analytics |
| `/app/settings` | Tracking toggles, sampling, retention, excluded paths |
| `/proxy/boot` · `/proxy/collect` · `/proxy/record` · `/proxy/survey` | App-proxy ingestion endpoints |
| `/webhooks/app/uninstalled` | `app/uninstalled` + GDPR compliance topics |
| `/healthz` | Readiness probe for Coolify |

## Environment variables

| Var | Value |
| --- | --- |
| `SHOPIFY_API_KEY` | App client id |
| `SHOPIFY_API_SECRET` | App client secret |
| `SHOPIFY_APP_URL` | `https://shoptrace.onkra.online` |
| `SCOPES` | `write_app_proxy` |
| `DATABASE_URL` | PostgreSQL connection string |

## Development

```bash
npm install
npm run dev          # shopify app dev
```

## Deploy

- **Server**: Dockerfile build on Coolify (health check `/healthz`).
- **Shopify config + extension**: `shopify app deploy` (pushes
  `shopify.app.toml` config and the theme extension).
- The vendored `extensions/shoptrace-tracker/assets/shoptrace-record.js` is
  `node_modules/rrweb/dist/rrweb.umd.min.cjs`; re-copy it when upgrading rrweb.

## Merchant setup

1. Install the app.
2. Online Store → Themes → Customize → **App embeds** → enable **Shoptrace
   Tracker** → Save.
3. Browse the storefront; data appears on the dashboard within a minute.
