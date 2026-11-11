import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That email and password did not match.");
      return;
    }
    await router.invalidate();
    await navigate({ to: "/dashboard" });
  }

  async function sendMagicLink() {
    if (email.trim() === "") {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.magicLink({ email, callbackURL: "/dashboard" });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "The sign-in link could not be sent.");
      return;
    }
    setLinkSent(true);
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p className="lede">Use the email address and password you signed up with.</p>

      {error ? <div className="notice error">{error}</div> : null}
      {linkSent ? (
        <div className="notice ok">
          If that address has an account, a sign-in link is on its way. It expires in 10 minutes.
        </div>
      ) : null}

      <form className="form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={sendMagicLink}>
            Email me a link instead
          </button>
        </div>
      </form>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        No account yet? <Link to="/sign-up">Create one</Link>.
      </p>
    </main>
  );
}
