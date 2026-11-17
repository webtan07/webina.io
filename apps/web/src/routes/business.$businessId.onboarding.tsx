/**
 * The setup wizard: sign-up to live chat in one page.
 *
 * Steps are derived from the database (see `components/steps.ts`), so this page
 * never claims a step is done because a browser said so. Each step's editor is
 * the same component the standalone page uses — there is one implementation of
 * "edit hours", not two.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";

import { TRADE_TEMPLATE_CHOICES, type TradeTemplate } from "@webina/shared";

import {
  applyTemplate,
  fetchHours,
  fetchInstall,
  fetchOnboarding,
  fetchServiceArea,
  fetchServices,
  fetchSettings,
  goLive,
  saveSettings,
} from "~/server/dashboard";
import { AreaForm } from "~/components/area-form";
import { HoursForm } from "~/components/hours-form";
import { InstallPanel } from "~/components/install-panel";
import { TestChatPanel } from "~/components/test-chat-panel";
import { setupSteps } from "~/components/steps";
import { Pill, ResultNotice, pricingSummary, type AnyResult } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/onboarding")({
  loader: async ({ params }) => {
    const businessId = params.businessId;
    return {
      onboarding: await fetchOnboarding({ data: { businessId } }),
      settings: await fetchSettings({ data: { businessId } }),
      services: await fetchServices({ data: { businessId } }),
      area: await fetchServiceArea({ data: { businessId } }),
      hours: await fetchHours({ data: { businessId } }),
      install: await fetchInstall({ data: { businessId } }),
    };
  },
  component: OnboardingPage,
});

function Step({
  number,
  title,
  done,
  children,
  hint,
}: {
  number: number;
  title: string;
  done: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="step">
      <header>
        <h2>
          {number}. {title}
        </h2>
        <Pill tone={done ? "ok" : "warn"}>{done ? "done" : "to do"}</Pill>
      </header>
      {hint ? <p className="muted">{hint}</p> : null}
      {children}
    </section>
  );
}

function OnboardingPage() {
  const data = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();

  const [templateResult, setTemplateResult] = useState<AnyResult | null>(null);
  const [liveResult, setLiveResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const onboarding = data.onboarding;
  if (onboarding.status !== "ok") return <ResultNotice result={onboarding} />;
  if (data.settings.status !== "ok") return <ResultNotice result={data.settings} />;

  const settings = data.settings.data;
  const progress = onboarding.data.progress;
  const steps = setupSteps(progress);
  const isDone = (key: string) => steps.find((step) => step.key === key)?.done ?? false;
  const missing = onboarding.data.missingForLive;

  async function chooseTemplate(trade: TradeTemplate, replace: boolean) {
    setBusy(true);
    setTemplateResult(null);
    try {
      const response = await applyTemplate({ data: { businessId, trade, replace } });
      setTemplateResult(response);
      if (response.status === "ok") await router.invalidate();
    } catch (error) {
      setTemplateResult({
        status: "error",
        message: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onGoLive() {
    setBusy(true);
    setLiveResult(null);
    try {
      const response = await goLive({ data: { businessId } });
      setLiveResult(response);
      if (response.status === "ok") await router.invalidate();
    } catch (error) {
      setLiveResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Set up {settings.name}</h2>
      <p className="muted">
        About fifteen minutes end to end. Nothing is switched on for customers until you press go
        live at the bottom.
      </p>

      <Step
        number={1}
        title="Pick your trade"
        done={isDone("template")}
        hint="This fills in services, prices, hours and the assistant's notes. Every one of them can be changed afterwards."
      >
        <ResultNotice result={templateResult} />
        <div className="grid">
          {TRADE_TEMPLATE_CHOICES.map((choice) => (
            <button
              key={choice.key}
              type="button"
              className={settings.tradeTemplate === choice.key ? "secondary" : "secondary"}
              disabled={busy}
              onClick={() => void chooseTemplate(choice.key, false)}
              style={{ textAlign: "left", padding: "0.8rem", cursor: "pointer" }}
            >
              <strong>{choice.label}</strong>
              <br />
              <span className="muted">{choice.summary}</span>
            </button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Already have services you want to keep? Applying a template only fills what is empty.{" "}
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() => {
              const choice = settings.tradeTemplate as TradeTemplate;
              void chooseTemplate(choice, true);
            }}
          >
            Start again from {settings.tradeTemplate.replace(/_/g, " ")} and replace everything
          </button>
          .
        </p>
      </Step>

      <Step
        number={2}
        title="Business and assistant details"
        done={isDone("details")}
        hint="What customers see, and how the assistant sounds."
      >
        <DetailsForm businessId={businessId} settings={settings} onSaved={() => router.invalidate()} />
      </Step>

      <Step
        number={3}
        title="Services and prices"
        done={isDone("services")}
        hint="The assistant only quotes what is on this list."
      >
        {data.services.status === "ok" && data.services.data.length > 0 ? (
          <div className="list">
            {data.services.data.slice(0, 6).map((service) => (
              <div className="row" key={service.id}>
                <div>
                  <h3>{service.name}</h3>
                  <p className="meta">
                    {pricingSummary(service)} · {service.active ? "available" : "switched off"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No services yet — pick a trade above, or add your own.</p>
        )}
        <div className="actions">
          <Link to="/business/$businessId/services" params={{ businessId }} className="button secondary">
            Edit services and prices
          </Link>
        </div>
      </Step>

      <Step number={4} title="Service area" done={isDone("area")} hint="Where you will travel to.">
        {data.area.status === "ok" ? (
          <AreaForm
            businessId={businessId}
            initial={data.area.data}
            onSaved={() => router.invalidate()}
          />
        ) : (
          <ResultNotice result={data.area} />
        )}
      </Step>

      <Step number={5} title="Opening hours" done={isDone("hours")}>
        {data.hours.status === "ok" ? (
          <HoursForm
            businessId={businessId}
            initialRules={data.hours.data.rules}
            initialExceptions={data.hours.data.exceptions}
            timezone={settings.timezone}
            onSaved={() => router.invalidate()}
          />
        ) : (
          <ResultNotice result={data.hours} />
        )}
      </Step>

      <Step
        number={6}
        title="Where should we send you jobs?"
        done={isDone("notifications")}
        hint="Every booking, job request and handoff is sent here."
      >
        <NotificationForm
          businessId={businessId}
          email={settings.ownerNotifyEmail}
          phone={settings.ownerNotifyPhone ?? ""}
          onSaved={() => router.invalidate()}
        />
      </Step>

      <Step
        number={7}
        title="Put the chat on your website"
        done={isDone("install")}
        hint="One line of code, then check it is really there."
      >
        {data.install.status === "ok" ? (
          <InstallPanel
            businessId={businessId}
            install={data.install.data}
            onChanged={() => router.invalidate()}
          />
        ) : (
          <ResultNotice result={data.install} />
        )}
      </Step>

      <Step
        number={8}
        title="Try it yourself"
        done={isDone("test")}
        hint="Chat to your assistant before a customer does."
      >
        <TestChatPanel businessId={businessId} onSent={() => router.invalidate()} />
      </Step>

      <Step
        number={9}
        title="Go live"
        done={isDone("live")}
        hint="Turns the assistant on for real customers on your website."
      >
        <ResultNotice result={liveResult} />
        {isDone("live") ? (
          <p>
            <Pill tone="ok">live</Pill> The assistant is answering. You can pause it any time in
            settings.
          </p>
        ) : (
          <>
            {missing.length > 0 ? (
              <p className="muted">Still needed: {missing.join(", ")}.</p>
            ) : null}
            <button type="button" onClick={() => void onGoLive()} disabled={busy || missing.length > 0}>
              {busy ? "Switching on…" : "Go live"}
            </button>
          </>
        )}
      </Step>
    </div>
  );
}

function DetailsForm({
  businessId,
  settings,
  onSaved,
}: {
  businessId: string;
  settings: { name: string; assistantName: string; greeting: string | null; tone: string; businessRules: string | null };
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(settings.name);
  const [assistantName, setAssistantName] = useState(settings.assistantName);
  const [greeting, setGreeting] = useState(settings.greeting ?? "");
  const [tone, setTone] = useState(settings.tone);
  const [businessRules, setBusinessRules] = useState(settings.businessRules ?? "");
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
        <input
          type="text"
          required
          maxLength={40}
          value={assistantName}
          onChange={(event) => setAssistantName(event.target.value)}
        />
      </label>
      <label>
        First thing it says
        <textarea maxLength={300} value={greeting} onChange={(event) => setGreeting(event.target.value)} />
      </label>
      <label>
        How should it sound?
        <input type="text" maxLength={200} value={tone} onChange={(event) => setTone(event.target.value)} />
      </label>
      <label>
        Anything it must always remember?
        <textarea maxLength={4000} value={businessRules} onChange={(event) => setBusinessRules(event.target.value)} />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}

function NotificationForm({
  businessId,
  email,
  phone,
  onSaved,
}: {
  businessId: string;
  email: string;
  phone: string;
  onSaved: () => void | Promise<void>;
}) {
  const [notifyEmail, setNotifyEmail] = useState(email);
  const [notifyPhone, setNotifyPhone] = useState(phone);
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
          ownerNotifyEmail: notifyEmail,
          ownerNotifyPhone: notifyPhone.trim() === "" ? null : notifyPhone,
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
        <input type="email" required value={notifyEmail} onChange={(event) => setNotifyEmail(event.target.value)} />
      </label>
      <label>
        Mobile for texts (optional, once SMS is switched on)
        <input type="tel" value={notifyPhone} onChange={(event) => setNotifyPhone(event.target.value)} />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save notification settings"}
        </button>
      </div>
    </form>
  );
}
