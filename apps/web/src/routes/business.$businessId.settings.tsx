/**
 * Settings: how the assistant sounds, where jobs are sent, which websites may
 * use the key, and the pause switch.
 *
 * Pausing (`bot_enabled`) is the honest kill switch: the widget keeps loading
 * and tells the customer the team will reply, and no model call is made.
 */

import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchSettings, saveAllowedOrigins, saveSettings } from "~/server/dashboard";
import { Pill, ResultNotice, type AnyResult } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/settings")({
  loader: ({ params }) => fetchSettings({ data: { businessId: params.businessId } }),
  component: SettingsPage,
});

function SettingsPage() {
  const result = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();
  const [pauseResult, setPauseResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (result.status !== "ok") return <ResultNotice result={result} />;
  const settings = result.data;
  const site = settings.sites[0] ?? null;

  async function togglePaused() {
    setBusy(true);
    setPauseResult(null);
    const response = await saveSettings({ data: { businessId, botEnabled: !settings.botEnabled } });
    setPauseResult(response);
    setBusy(false);
    if (response.status === "ok") await router.invalidate();
  }

  return (
    <div>
      <h2>Settings</h2>

      <section className="card">
        <h3>
          The assistant{" "}
          {settings.botEnabled ? (
            <Pill tone="ok">answering</Pill>
          ) : (
            <Pill tone="warn">paused</Pill>
          )}
        </h3>
        <p className="muted">
          Pausing stops the assistant answering anyone. Customers see a message that the team will
          reply, and you get the conversation in your inbox.
        </p>
        <ResultNotice result={pauseResult} />
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="secondary" disabled={busy} onClick={() => void togglePaused()}>
            {settings.botEnabled ? "Pause the assistant" : "Turn the assistant back on"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Name, greeting and tone</h3>
        <AssistantForm businessId={businessId} settings={settings} onSaved={() => router.invalidate()} />
      </section>

      <section className="card">
        <h3>Where jobs are sent</h3>
        <NotifyForm businessId={businessId} settings={settings} onSaved={() => router.invalidate()} />
      </section>

      <section className="card">
        <h3>Website and key</h3>
        <p className="muted">
          Site key <code>{site?.siteKey ?? "none yet"}</code>. The key is public; this address list
          is what stops anyone else using it.
        </p>
        {site ? (
          <OriginsForm
            businessId={businessId}
            siteId={site.id}
            initial={site.allowedOrigins}
            onSaved={() => router.invalidate()}
          />
        ) : null}
        <div className="actions" style={{ marginTop: 0 }}>
          <Link to="/business/$businessId/install" params={{ businessId }} className="button secondary">
            Install snippet and check
          </Link>
        </div>
      </section>

      <section className="card">
        <h3>Services, area and hours</h3>
        <p className="muted">These have their own pages because they are edited often.</p>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link to="/business/$businessId/services" params={{ businessId }} className="button secondary">
            Services and prices
          </Link>
          <Link to="/business/$businessId/area" params={{ businessId }} className="button secondary">
            Service area
          </Link>
          <Link to="/business/$businessId/hours" params={{ businessId }} className="button secondary">
            Opening hours
          </Link>
        </div>
      </section>

      <p className="muted">
        Billing, plan and invoices arrive in the next milestone; nothing here charges you.
      </p>
    </div>
  );
}

interface SettingsShape {
  name: string;
  assistantName: string;
  greeting: string | null;
  tone: string;
  businessRules: string | null;
  brandColor: string | null;
  showPoweredBy: boolean;
  timezone: string;
  ownerNotifyEmail: string;
  ownerNotifyPhone: string | null;
}

function AssistantForm({
  businessId,
  settings,
  onSaved,
}: {
  businessId: string;
  settings: SettingsShape;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(settings.name);
  const [assistantName, setAssistantName] = useState(settings.assistantName);
  const [greeting, setGreeting] = useState(settings.greeting ?? "");
  const [tone, setTone] = useState(settings.tone);
  const [businessRules, setBusinessRules] = useState(settings.businessRules ?? "");
  const [brandColor, setBrandColor] = useState(settings.brandColor ?? "#0f7b8a");
  const [showPoweredBy, setShowPoweredBy] = useState(settings.showPoweredBy);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await saveSettings({
        data: {
          businessId,
          name,
          assistantName,
          greeting: greeting.trim() === "" ? null : greeting,
          tone,
          businessRules: businessRules.trim() === "" ? null : businessRules,
          brandColor,
          showPoweredBy,
          timezone,
        },
      });
      setResult(response);
      if (response.status === "ok") await onSaved();
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form narrow" onSubmit={onSubmit}>
      <ResultNotice result={result} />
      <label>
        Business name
        <input type="text" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Assistant's name
        <input type="text" required maxLength={40} value={assistantName} onChange={(event) => setAssistantName(event.target.value)} />
      </label>
      <label>
        First thing it says
        <textarea maxLength={300} value={greeting} onChange={(event) => setGreeting(event.target.value)} />
      </label>
      <label>
        Tone
        <input type="text" maxLength={200} value={tone} onChange={(event) => setTone(event.target.value)} />
      </label>
      <label>
        Rules it must always follow
        <textarea maxLength={4000} value={businessRules} onChange={(event) => setBusinessRules(event.target.value)} />
      </label>
      <label>
        Brand colour
        <input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} />
      </label>
      <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <input type="checkbox" checked={showPoweredBy} onChange={(event) => setShowPoweredBy(event.target.checked)} />
        Show "Powered by Webina" in the chat
      </label>
      <label>
        Timezone
        <input type="text" required value={timezone} onChange={(event) => setTimezone(event.target.value)} />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function NotifyForm({
  businessId,
  settings,
  onSaved,
}: {
  businessId: string;
  settings: SettingsShape;
  onSaved: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState(settings.ownerNotifyEmail);
  const [phone, setPhone] = useState(settings.ownerNotifyPhone ?? "");
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await saveSettings({
        data: {
          businessId,
          ownerNotifyEmail: email,
          ownerNotifyPhone: phone.trim() === "" ? null : phone,
        },
      });
      setResult(response);
      if (response.status === "ok") await onSaved();
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form narrow" onSubmit={onSubmit}>
      <ResultNotice result={result} />
      <label>
        Email for new jobs
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Mobile (used once SMS reminders are switched on)
        <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function OriginsForm({
  businessId,
  siteId,
  initial,
  onSaved,
}: {
  businessId: string;
  siteId: string;
  initial: string[];
  onSaved: () => void | Promise<void>;
}) {
  const [origins, setOrigins] = useState(initial.join(", "));
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await saveAllowedOrigins({
        data: {
          businessId,
          siteId,
          allowedOrigins: origins
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value !== ""),
        },
      });
      setResult(response);
      if (response.status === "ok") await onSaved();
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form narrow" onSubmit={onSubmit}>
      <ResultNotice result={result} />
      <label>
        Website addresses, comma-separated
        <input
          type="text"
          placeholder="https://www.example.com.au"
          value={origins}
          onChange={(event) => setOrigins(event.target.value)}
        />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" className="secondary" disabled={busy}>
          {busy ? "Saving…" : "Save addresses"}
        </button>
      </div>
    </form>
  );
}
