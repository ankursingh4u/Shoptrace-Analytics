import { Form, useLoaderData, useNavigation } from "react-router";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateSettings } from "../lib/ingest.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateSettings(session.shop);
  return { settings, shop: session.shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  await getOrCreateSettings(session.shop);
  await prisma.shopSettings.update({
    where: { shop: session.shop },
    data: {
      trackingEnabled: form.get("trackingEnabled") === "on",
      recordingEnabled: form.get("recordingEnabled") === "on",
      recordingSampleRate: Math.max(1, Math.min(100, Number(form.get("sampleRate")) || 100)),
      recordingMaxSeconds: Math.max(30, Math.min(1800, Number(form.get("maxSeconds")) || 300)),
      retentionDays: Math.max(7, Math.min(365, Number(form.get("retentionDays")) || 30)),
      excludePaths: String(form.get("excludePaths") || "").slice(0, 2000),
    },
  });
  return { saved: true };
};

const fieldStyle = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--st-grid)",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function Toggle({ name, label, hint, defaultChecked }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} style={{ marginTop: 3, accentColor: "var(--st-primary)" }} />
      <span>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--st-ink)" }}>{label}</span>
        <span style={{ fontSize: 12.5, color: "var(--st-muted)" }}>{hint}</span>
      </span>
    </label>
  );
}

export default function Settings() {
  const { settings, shop } = useLoaderData();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <Page fullWidth>
      <div className="st-hero" style={{ padding: "20px 28px" }}>
        <h1>Settings</h1>
        <p>Control what Shoptrace captures on {shop.replace(".myshopify.com", "")}.</p>
      </div>

      <div className="st-grid-2">
        <Form method="post" className="st-panel">
          <h3 className="st-panel-title">Tracking</h3>
          <p className="st-panel-sub">Changes take effect on the next page a visitor opens.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Toggle
              name="trackingEnabled"
              label="Enable visitor tracking"
              hint="Master switch — turns off analytics, heatmaps, recordings and surveys."
              defaultChecked={settings.trackingEnabled}
            />
            <Toggle
              name="recordingEnabled"
              label="Session recordings"
              hint="Capture replays of visitor sessions. Form inputs are always masked."
              defaultChecked={settings.recordingEnabled}
            />
            <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
              Recording sample rate (% of sessions)
              <input name="sampleRate" type="number" min="1" max="100" defaultValue={settings.recordingSampleRate} style={fieldStyle} />
            </label>
            <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
              Max recording length per session (seconds)
              <input name="maxSeconds" type="number" min="30" max="1800" defaultValue={settings.recordingMaxSeconds} style={fieldStyle} />
            </label>
            <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
              Keep visitor data for (days)
              <input name="retentionDays" type="number" min="7" max="365" defaultValue={settings.retentionDays} style={fieldStyle} />
            </label>
            <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
              Don’t track pages starting with (one path per line)
              <textarea name="excludePaths" rows={3} defaultValue={settings.excludePaths} style={fieldStyle} placeholder={"/pages/private\n/blogs/internal"} />
            </label>
            <div>
              <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        </Form>

        <div className="st-panel">
          <h3 className="st-panel-title">Setup checklist</h3>
          <p className="st-panel-sub">Two steps and data starts flowing.</p>
          <div className="st-steps">
            <div className="st-step">
              <span className="st-step-num">1</span>
              <span className="st-step-body">
                Open <b>Online Store → Themes → Customize</b>, click the <b>App embeds</b> icon
                in the left sidebar, switch on <b>Shoptrace Tracker</b>, and save the theme.
              </span>
            </div>
            <div className="st-step">
              <span className="st-step-num">2</span>
              <span className="st-step-body">
                Visit your storefront in a new tab, browse a couple of pages — your
                session appears on the <b>Dashboard</b> within a minute.
              </span>
            </div>
            <div className="st-step">
              <span className="st-step-num">✓</span>
              <span className="st-step-body">
                <b>Privacy:</b> Shoptrace never stores names, emails or payment details.
                Keystrokes in form fields are masked in recordings, and all visitor data
                is deleted automatically after your retention window, and immediately if
                you uninstall.
              </span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ height: 20 }} />
    </Page>
  );
}
