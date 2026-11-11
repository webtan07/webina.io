import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { TRADE_TEMPLATES } from "@webina/shared";

import { authClient } from "~/lib/auth-client";
import { createBusinessForCurrentUser, fetchDashboard } from "~/server/functions";

export const Route = createFileRoute("/dashboard")({
  loader: () => fetchDashboard(),
  component: DashboardPage,
});

function DashboardPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  if (result.status === "signed_out") {
    return (
      <main>
        <h1>Dashboard</h1>
        <p className="lede">Sign in to see your businesses.</p>
        <div className="actions">
          <Link to="/sign-in" className="button">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1>Your businesses</h1>
          <p className="muted">Signed in as {result.user.email}</p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await authClient.signOut();
            await router.invalidate();
            await navigate({ to: "/" });
          }}
        >
          Sign out
        </button>
      </div>

      {result.businesses.length === 0 ? (
        <p className="lede" style={{ marginTop: "1.5rem" }}>
          You are not part of a business yet. Add the first one below.
        </p>
      ) : (
        <div style={{ marginTop: "1.5rem" }}>
          {result.businesses.map((business) => (
            <article className="card" key={business.businessId}>
              <h2>
                <Link
                  to="/business/$businessId"
                  params={{ businessId: business.businessId }}
                >
                  {business.name}
                </Link>
              </h2>
              <p className="muted">
                {business.role} · {business.timezone} · webina.io/{business.slug}
              </p>
            </article>
          ))}
        </div>
      )}

      <NewBusinessForm
        defaultEmail={result.user.email}
        onCreated={async (businessId) => {
          await router.invalidate();
          await navigate({ to: "/business/$businessId", params: { businessId } });
        }}
      />
    </main>
  );
}

function NewBusinessForm({
  defaultEmail,
  onCreated,
}: {
  defaultEmail: string;
  onCreated: (businessId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [tradeTemplate, setTradeTemplate] = useState<string>("generic");
  const [timezone, setTimezone] = useState("Australia/Adelaide");
  const [assistantName, setAssistantName] = useState("Webina");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createBusinessForCurrentUser({
      data: {
        name,
        tradeTemplate: tradeTemplate as (typeof TRADE_TEMPLATES)[number],
        timezone,
        ownerNotifyEmail: defaultEmail,
        assistantName,
      },
    });
    setBusy(false);
    if (result.status === "invalid") {
      setError(result.message);
      return;
    }
    if (result.status === "signed_out") {
      setError("Your session expired. Sign in again.");
      return;
    }
    await onCreated(result.businessId);
  }

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <h2>Add a business</h2>
      <p className="muted">
        This creates the business, your owner membership and its first website key together.
      </p>
      {error ? <div className="notice error">{error}</div> : null}
      <form className="form narrow" onSubmit={onSubmit}>
        <label>
          Business name
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Trade
          <select value={tradeTemplate} onChange={(event) => setTradeTemplate(event.target.value)}>
            {TRADE_TEMPLATES.map((trade) => (
              <option key={trade} value={trade}>
                {trade.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timezone
          <input
            type="text"
            required
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
        <label>
          Assistant name
          <input
            type="text"
            required
            maxLength={40}
            value={assistantName}
            onChange={(event) => setAssistantName(event.target.value)}
          />
        </label>
        <p className="muted">Enquiry notifications go to {defaultEmail}.</p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create business"}
          </button>
        </div>
      </form>
    </section>
  );
}
