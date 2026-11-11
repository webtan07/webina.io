import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <main>
      <div className="hero">
        <p className="eyebrow">The AI front desk for local service businesses</p>
        <h1>Never miss another customer while you are on the tools.</h1>
        <p className="lede">
          Webina answers the enquiries that arrive while you are working. It quotes from your own
          price list, checks your service area, offers real slots and books the job — and hands the
          conversation to you the moment it is unsure.
        </p>
        <div className="actions">
          <Link to="/sign-up" className="button">
            Create your account
          </Link>
          <Link to="/sign-in" className="button secondary">
            Sign in
          </Link>
        </div>
      </div>

      <section className="card" style={{ marginTop: "2.5rem" }}>
        <h2>What this shell is</h2>
        <p className="muted">
          Milestone 1: accounts, businesses and the tenancy boundary. An owner signs in, sees only
          the businesses they belong to, and every query is scoped to one business by membership
          and again by row-level security in Postgres.
        </p>
      </section>
    </main>
  );
}
