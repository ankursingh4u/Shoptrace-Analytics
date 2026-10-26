import { Link, useLoaderData } from "react-router";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BarList, SERIES, StatTile } from "../components/charts";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const survey = await prisma.survey.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!survey) throw new Response("Survey not found", { status: 404 });

  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId: survey.id },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return { survey, responses };
};

export default function SurveyDetail() {
  const { survey, responses } = useLoaderData();

  let summary = null;
  if (survey.type === "rating") {
    const nums = responses.map((r) => Number(r.answer)).filter((n) => n >= 1 && n <= 5);
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    const dist = [5, 4, 3, 2, 1].map((star) => ({
      label: `${"★".repeat(star)}`,
      value: nums.filter((n) => n === star).length,
    }));
    summary = (
      <>
        <div className="st-tiles">
          <StatTile label="Responses" value={responses.length.toLocaleString()} accent="teal" />
          <StatTile label="Average rating" value={avg ? avg.toFixed(1) + " / 5" : "—"} accent="violet" />
        </div>
        <div className="st-panel" style={{ marginBottom: 12 }}>
          <h3 className="st-panel-title">Rating distribution</h3>
          <p className="st-panel-sub">All responses</p>
          <BarList items={dist} color={SERIES.violet} />
        </div>
      </>
    );
  } else if (survey.type === "choice") {
    const counts = new Map();
    for (const r of responses) counts.set(r.answer, (counts.get(r.answer) || 0) + 1);
    summary = (
      <>
        <div className="st-tiles">
          <StatTile label="Responses" value={responses.length.toLocaleString()} accent="teal" />
        </div>
        <div className="st-panel" style={{ marginBottom: 12 }}>
          <h3 className="st-panel-title">Answer breakdown</h3>
          <p className="st-panel-sub">All responses</p>
          <BarList
            items={[...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, value]) => ({ label, value }))}
            color={SERIES.teal}
          />
        </div>
      </>
    );
  } else {
    summary = (
      <div className="st-tiles">
        <StatTile label="Responses" value={responses.length.toLocaleString()} accent="teal" />
      </div>
    );
  }

  return (
    <Page fullWidth>
      <div className="st-rangebar">
        <Link to="/app/surveys" className="st-btn st-btn-ghost">
          ← All surveys
        </Link>
        <span className="st-pill st-pill-violet">{survey.name}</span>
        {survey.status === "active" ? (
          <span className="st-pill st-pill-teal">Active</span>
        ) : (
          <span className="st-pill st-pill-amber">Paused</span>
        )}
      </div>

      <div className="st-hero" style={{ padding: "20px 28px" }}>
        <h1 style={{ fontSize: 18 }}>“{survey.question}”</h1>
        <p>
          {survey.type === "text" ? "Free text" : survey.type === "rating" ? "Rating 1–5" : "Multiple choice"} ·
          shows after {survey.triggerDelay}s · {survey.pagePattern ? `pages starting with ${survey.pagePattern}` : "all pages"}
        </p>
      </div>

      {summary}

      <div className="st-panel" style={{ marginBottom: 20 }}>
        <h3 className="st-panel-title">Individual responses</h3>
        <p className="st-panel-sub">Latest {responses.length} responses</p>
        {responses.length === 0 ? (
          <div className="st-empty">
            <div className="st-empty-icon">💬</div>
            <h3>No responses yet</h3>
            <p>Responses appear here as soon as visitors answer on your storefront.</p>
          </div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>Answer</th>
                <th style={{ width: 180 }}>When</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <tr key={r.id}>
                  <td>{survey.type === "rating" ? "★".repeat(Number(r.answer) || 0) || r.answer : r.answer}</td>
                  <td style={{ color: "var(--st-muted)" }}>{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
