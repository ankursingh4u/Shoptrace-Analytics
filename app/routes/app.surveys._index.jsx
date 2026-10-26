import { useState } from "react";
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const surveys = await prisma.survey.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  const counts = await prisma.surveyResponse.groupBy({
    by: ["surveyId"],
    where: { shop: session.shop },
    _count: { surveyId: true },
  });
  const countMap = Object.fromEntries(counts.map((c) => [c.surveyId, c._count.surveyId]));
  return {
    surveys: surveys.map((s) => ({ ...s, responses: countMap[s.id] || 0 })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const type = ["text", "rating", "choice"].includes(form.get("type"))
      ? form.get("type")
      : "text";
    const options =
      type === "choice"
        ? JSON.stringify(
            String(form.get("options") || "")
              .split("\n")
              .map((o) => o.trim())
              .filter(Boolean)
              .slice(0, 6),
          )
        : "[]";
    await prisma.survey.create({
      data: {
        shop: session.shop,
        name: String(form.get("name") || "Untitled survey").slice(0, 120),
        question: String(form.get("question") || "").slice(0, 300),
        type,
        options,
        triggerDelay: Math.max(0, Math.min(120, Number(form.get("delay")) || 5)),
        pagePattern: String(form.get("pages") || "").slice(0, 200),
      },
    });
  }

  if (intent === "toggle") {
    const survey = await prisma.survey.findFirst({
      where: { id: String(form.get("id")), shop: session.shop },
    });
    if (survey) {
      await prisma.survey.update({
        where: { id: survey.id },
        data: { status: survey.status === "active" ? "paused" : "active" },
      });
    }
  }

  if (intent === "delete") {
    const survey = await prisma.survey.findFirst({
      where: { id: String(form.get("id")), shop: session.shop },
    });
    if (survey) {
      await prisma.surveyResponse.deleteMany({ where: { surveyId: survey.id } });
      await prisma.survey.delete({ where: { id: survey.id } });
    }
  }

  return null;
};

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--st-grid)",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export default function Surveys() {
  const { surveys } = useLoaderData();
  const navigation = useNavigation();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState("text");
  const busy = navigation.state === "submitting";

  return (
    <Page fullWidth>
      <div className="st-hero" style={{ padding: "20px 28px" }}>
        <h1>Surveys</h1>
        <p>Ask visitors questions right on your storefront and collect answers here.</p>
      </div>

      <div className="st-rangebar">
        <button className="st-btn st-btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close" : "✚ New survey"}
        </button>
      </div>

      {showForm ? (
        <div className="st-panel" style={{ marginBottom: 12 }}>
          <h3 className="st-panel-title">Create survey</h3>
          <p className="st-panel-sub">The widget appears bottom-right on matching pages.</p>
          <Form method="post" onSubmit={() => setShowForm(false)}>
            <input type="hidden" name="intent" value="create" />
            <div className="st-grid-2">
              <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
                Internal name
                <input name="name" required maxLength={120} style={inputStyle} placeholder="Post-purchase feedback" />
              </label>
              <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
                Question shown to visitors
                <input name="question" required maxLength={300} style={inputStyle} placeholder="How did you hear about us?" />
              </label>
              <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
                Answer type
                <select name="type" value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
                  <option value="text">Free text</option>
                  <option value="rating">Rating 1–5</option>
                  <option value="choice">Multiple choice</option>
                </select>
              </label>
              <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
                Show after (seconds on page)
                <input name="delay" type="number" min="0" max="120" defaultValue={5} style={inputStyle} />
              </label>
              {type === "choice" ? (
                <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
                  Choices (one per line, max 6)
                  <textarea name="options" rows={4} style={inputStyle} placeholder={"Google\nInstagram\nA friend"} />
                </label>
              ) : null}
              <label style={{ fontSize: 12.5, color: "var(--st-ink-2)" }}>
                Only on pages starting with (optional)
                <input name="pages" maxLength={200} style={inputStyle} placeholder="/products" />
              </label>
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Create survey"}
              </button>
            </div>
          </Form>
        </div>
      ) : null}

      <div className="st-panel">
        {surveys.length === 0 ? (
          <div className="st-empty">
            <div className="st-empty-icon">💬</div>
            <h3>No surveys yet</h3>
            <p>Create your first survey to start hearing directly from visitors.</p>
          </div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th>Survey</th>
                <th>Type</th>
                <th>Status</th>
                <th>Shows on</th>
                <th>Responses</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/app/surveys/${s.id}`} style={{ color: "var(--st-primary-strong)", fontWeight: 600, textDecoration: "none" }}>
                      {s.name}
                    </Link>
                    <div style={{ fontSize: 12, color: "var(--st-muted)" }}>{s.question}</div>
                  </td>
                  <td>
                    <span className="st-pill st-pill-violet">
                      {s.type === "text" ? "Free text" : s.type === "rating" ? "Rating" : "Choice"}
                    </span>
                  </td>
                  <td>
                    {s.status === "active" ? (
                      <span className="st-pill st-pill-teal">Active</span>
                    ) : (
                      <span className="st-pill st-pill-amber">Paused</span>
                    )}
                  </td>
                  <td>{s.pagePattern ? <code style={{ fontSize: 12 }}>{s.pagePattern}*</code> : "All pages"}</td>
                  <td>
                    <b>{s.responses}</b>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="id" value={s.id} />
                      <button className="st-btn st-btn-ghost" style={{ padding: "5px 12px", marginRight: 6 }} type="submit">
                        {s.status === "active" ? "Pause" : "Resume"}
                      </button>
                    </Form>
                    <Form
                      method="post"
                      style={{ display: "inline" }}
                      onSubmit={(e) => {
                        if (!confirm("Delete this survey and all its responses?")) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={s.id} />
                      <button className="st-btn st-btn-danger" style={{ padding: "5px 12px" }} type="submit">
                        Delete
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
