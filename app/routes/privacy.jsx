// Public privacy policy page, linked from the app listing.
export const loader = () => null;

const wrap = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "48px 24px",
  fontFamily: "Inter, system-ui, sans-serif",
  color: "#0b1626",
  lineHeight: 1.65,
  fontSize: 14.5,
};

export default function Privacy() {
  return (
    <div style={wrap}>
      <h1>Shoptrace Analytics — Privacy Policy</h1>
      <p>
        Shoptrace Analytics (“the app”) helps Shopify merchants understand how
        visitors use their storefront through anonymous analytics, session
        recordings, heatmaps and surveys.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Anonymous visitor behaviour: pages viewed, clicks, scroll depth, device and browser type, language, approximate region derived from timezone, and referrer.</li>
        <li>Session replays recorded with input masking — text typed into forms is never captured.</li>
        <li>Survey answers that visitors voluntarily submit.</li>
      </ul>
      <h2>What we never collect</h2>
      <ul>
        <li>Names, email addresses, phone numbers, payment details or account identifiers.</li>
        <li>Checkout or payment pages.</li>
        <li>Precise location or IP-based geolocation.</li>
      </ul>
      <h2>Retention & deletion</h2>
      <p>
        Visitor data is deleted automatically after the merchant's configured
        retention window (30 days by default, up to 365). All data for a shop is
        permanently deleted when the app is uninstalled, and on receipt of a
        shop redaction request from Shopify.
      </p>
      <h2>Contact</h2>
      <p>Questions? Contact the app support email shown on the app listing.</p>
    </div>
  );
}
