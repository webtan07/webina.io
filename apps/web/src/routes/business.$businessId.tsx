import { Link, createFileRoute } from "@tanstack/react-router";

import { fetchBusiness } from "~/server/functions";

export const Route = createFileRoute("/business/$businessId")({
  loader: ({ params }) => fetchBusiness({ data: { businessId: params.businessId } }),
  component: BusinessPage,
});

function BusinessPage() {
  const result = Route.useLoaderData();
  const { businessId } = Route.useParams();

  if (result.status === "signed_out") {
    return (
      <main>
        <h1>Sign in required</h1>
        <p className="lede">Sign in to open this business.</p>
        <div className="actions">
          <Link to="/sign-in" className="button">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (result.status === "forbidden") {
    // Same answer whether the business belongs to somebody else or does not
    // exist: nothing about other tenants leaks through this page.
    return (
      <main>
        <h1>No access</h1>
        <p className="lede">
          Your account is not a member of this business. If it should be, ask its owner to add you.
        </p>
        <div className="actions">
          <Link to="/dashboard" className="button secondary">
            Back to your businesses
          </Link>
        </div>
        <p className="muted" style={{ marginTop: "1.5rem" }}>
          Reference: <code>{businessId}</code>
        </p>
      </main>
    );
  }

  const business = result.business;

  return (
    <main>
      <p className="eyebrow">{business.tradeTemplate.replace(/_/g, " ")}</p>
      <h1>{business.name}</h1>
      <p className="muted">
        {business.assistantName} answers as this business · {business.status}
      </p>

      <section className="card" style={{ marginTop: "1.75rem" }}>
        <h2>Business</h2>
        <dl className="detail">
          <dt>Slug</dt>
          <dd className="mono">{business.slug}</dd>
          <dt>Timezone</dt>
          <dd>{business.timezone}</dd>
          <dt>Status</dt>
          <dd>{business.status}</dd>
          <dt>Assistant name</dt>
          <dd>{business.assistantName}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Website keys</h2>
        {business.sites.length === 0 ? (
          <p className="muted">No site keys yet.</p>
        ) : (
          business.sites.map((site) => (
            <dl className="detail" key={site.id} style={{ marginBottom: "0.75rem" }}>
              <dt>{site.label ?? "Site"}</dt>
              <dd>
                <code>{site.siteKey}</code>{" "}
                <span className="muted">
                  {site.isActive ? "active" : "switched off"} ·{" "}
                  {site.allowedOrigins.length === 0
                    ? "no origins registered yet"
                    : site.allowedOrigins.join(", ")}
                </span>
              </dd>
            </dl>
          ))
        )}
        <p className="muted">
          A website key is public. The registered origin is what makes it a tenant boundary.
        </p>
      </section>

      <div className="actions">
        <Link to="/dashboard" className="button secondary">
          Back to your businesses
        </Link>
      </div>
    </main>
  );
}
