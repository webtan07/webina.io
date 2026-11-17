/**
 * Install: the snippet, the website address it may run on, and the check.
 *
 * The check is the honest part — it fetches the owner's own page from the
 * server and looks for the snippet in the HTML. It never claims the widget
 * "works"; it says whether the tag is on the page, and when it cannot tell, it
 * says that instead.
 */

import { useState, type FormEvent } from "react";

import { checkInstallation, saveAllowedOrigins, type InstallCheckResult, type InstallView } from "~/server/dashboard";
import { Pill, ResultNotice, type AnyResult } from "~/components/ui";

export function InstallPanel({
  businessId,
  install,
  onChanged,
}: {
  businessId: string;
  install: InstallView;
  onChanged: () => void | Promise<void>;
}) {
  const site = install.sites[0] ?? null;
  const [origins, setOrigins] = useState((site?.allowedOrigins ?? []).join(", "));
  const [saveResult, setSaveResult] = useState<AnyResult | null>(null);
  const [checkResult, setCheckResult] = useState<AnyResult | null>(null);
  const [checked, setChecked] = useState<InstallCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onSaveOrigins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site) return;
    setSaveResult(null);
    try {
      const response = await saveAllowedOrigins({
        data: {
          businessId,
          siteId: site.id,
          allowedOrigins: origins
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value !== ""),
        },
      });
      setSaveResult(response);
      if (response.status === "ok") await onChanged();
    } catch (error) {
      setSaveResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    }
  }

  async function onCheck() {
    if (!site) return;
    setBusy(true);
    setCheckResult(null);
    setChecked(null);
    try {
      const response = await checkInstallation({ data: { businessId, siteId: site.id } });
      setCheckResult(response);
      if (response.status === "ok") {
        setChecked(response.data);
        await onChanged();
      }
    } catch (error) {
      setCheckResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(install.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (!site) {
    return <p className="muted">This business has no website key yet. Create one from the dashboard first.</p>;
  }

  return (
    <div>
      <h2>1. Paste this into your website</h2>
      <p className="muted">
        Put it just before <code>&lt;/body&gt;</code> on every page, or in your theme's footer code.
      </p>
      <pre className="code">{install.snippet}</pre>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="secondary" onClick={() => void onCopy()}>
          {copied ? "Copied" : "Copy snippet"}
        </button>
      </div>

      <h2 style={{ marginTop: "2rem" }}>2. Which website is it on?</h2>
      <p className="muted">
        The key is public. This address is what stops somebody else using it: the widget only
        answers on the site you list here.
      </p>
      <ResultNotice result={saveResult} />
      <form className="form narrow" onSubmit={onSaveOrigins}>
        <label>
          Your website address (comma-separated for more than one)
          <input
            type="text"
            placeholder="https://www.example.com.au"
            value={origins}
            onChange={(event) => setOrigins(event.target.value)}
          />
        </label>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" className="secondary">
            Save address
          </button>
        </div>
      </form>

      <h2 style={{ marginTop: "2rem" }}>3. Check installation</h2>
      <p className="muted">
        We fetch your page and look for the snippet. If your site is behind a login or a bot
        blocker, the check cannot see it — that does not mean it is not installed.
      </p>
      <ResultNotice result={checkResult} />
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" onClick={() => void onCheck()} disabled={busy || site.allowedOrigins.length === 0}>
          {busy ? "Checking…" : "Check installation"}
        </button>
      </div>

      {checked ? (
        <div className={checked.found ? "notice ok" : "notice error"} style={{ marginTop: "1rem" }}>
          <p style={{ margin: 0 }}>{checked.message}</p>
          <p className="muted" style={{ margin: 0 }}>
            {checked.url}
            {checked.status === null ? "" : ` · HTTP ${checked.status}`}
          </p>
        </div>
      ) : null}

      {install.lastCheck && !checked ? (
        <p className="muted">
          Last check {install.lastCheck.found ? "found the snippet" : "did not find the snippet"} on{" "}
          {install.lastCheck.url} ·{" "}
          <Pill tone={install.lastCheck.found ? "ok" : "warn"}>
            {install.lastCheck.found ? "found" : "not found"}
          </Pill>
        </p>
      ) : null}
    </div>
  );
}
