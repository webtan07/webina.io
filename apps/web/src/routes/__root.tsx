import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Webina — the AI front desk for local service businesses" },
      {
        name: "description",
        content:
          "Webina answers your customers, quotes from your price list and books the job — so you stop losing work while you are on the tools.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the start</Link>
      </p>
    </main>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <header className="site-header">
        <Link to="/" className="wordmark">
          Webina<span>.</span>
        </Link>
        <nav className="site-nav">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/sign-in">Sign in</Link>
          <Link to="/sign-up" className="button">
            Create account
          </Link>
        </nav>
      </header>
      <Outlet />
      <footer className="site-footer">
        Webina is a product of Web Digital Assistants · Prices in AUD · A sole trader, so no GST
        applies.
      </footer>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
