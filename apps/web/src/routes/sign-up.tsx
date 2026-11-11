import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signUp.email({ name, email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "The account could not be created.");
      return;
    }
    await router.invalidate();
    await navigate({ to: "/dashboard" });
  }

  return (
    <main>
      <h1>Create your account</h1>
      <p className="lede">
        One account can look after more than one business. You can add your first business straight
        after this.
      </p>

      {error ? <div className="notice error">{error}</div> : null}

      <form className="form" onSubmit={onSubmit}>
        <label>
          Your name
          <input
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
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
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="muted">At least 10 characters.</span>
        </label>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        Already have an account? <Link to="/sign-in">Sign in</Link>.
      </p>
    </main>
  );
}
