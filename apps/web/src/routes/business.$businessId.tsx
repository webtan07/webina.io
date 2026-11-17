/**
 * The shell every tenant page lives inside.
 *
 * The loader is the authorisation gate: it resolves the session, then the
 * membership, then reads the business inside RLS. A page under this route
 * cannot render without all three, so no child page needs its own check.
 */

import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { fetchBusiness } from "~/server/functions";

export const Route = createFileRoute("/business/$businessId")({
  loader: ({ params }) => fetchBusiness({ data: { businessId: params.businessId } }),
  component: BusinessLayout,
});

const NAV = [
  { to: "/business/$businessId", label: "Overview" },
  { to: "/business/$businessId/onboarding", label: "Setup" },
  { to: "/business/$businessId/services", label: "Services" },
  { to: "/business/$businessId/area", label: "Area" },
  { to: "/business/$businessId/hours", label: "Hours" },
  { to: "/business/$businessId/conversations", label: "Conversations" },
  { to: "/business/$businessId/bookings", label: "Bookings" },
  { to: "/business/$businessId/requests", label: "Requests" },
  { to: "/business/$businessId/handoffs", label: "Handoffs" },
  { to: "/business/$businessId/test-chat", label: "Test chat" },
  { to: "/business/$businessId/install", label: "Install" },
  { to: "/business/$businessId/settings", label: "Settings" },
] as const;

function BusinessLayout() {
  const result = Route.useLoaderData();
  const { businessId } = Route.useParams();

  if (result.status === "signed_out") {
    return (
      <main className="app-shell">
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
      <main className="app-shell">
        <h1>No access</h1>
        <p className="lede">
          Your account is not a member of this business. If it should be, ask its owner to add you.
        </p>
        <div className="actions">
          <Link to="/dashboard" className="button secondary">
            Back to your businesses
          </Link>
        </div>
      </main>
    );
  }

  const business = result.business;

  return (
    <main className="app-shell">
      <p className="eyebrow">{business.tradeTemplate.replace(/_/g, " ")}</p>
      <h1 style={{ marginBottom: "0.2rem" }}>{business.name}</h1>
      <p className="muted" style={{ marginBottom: "1.25rem" }}>
        {business.assistantName} answers as this business · {business.status}
        {business.sites[0] ? ` · ${business.sites[0].siteKey}` : ""}
      </p>

      <nav className="subnav">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            params={{ businessId }}
            activeProps={{ "data-status": "active" }}
            activeOptions={{ exact: item.to === "/business/$businessId" }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <Outlet />
    </main>
  );
}
