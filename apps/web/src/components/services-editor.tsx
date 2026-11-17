/**
 * The services and prices editor.
 *
 * Prices are typed in dollars and stored as whole cents — the only unit the
 * assistant, the tools and the database ever use. A tiered service (a lawn
 * mowing size, a package) is edited as a short list of "label: price" lines,
 * which is the least surprising thing an owner can be asked to type.
 */

import { useState, type FormEvent } from "react";

import { PRICING_TYPES, SCHEDULING_TYPES } from "@webina/shared";
import { saveService, setServiceActive, type ServiceView } from "~/server/dashboard";
import { Pill, ResultNotice, pricingSummary, type AnyResult } from "~/components/ui";

interface Option {
  key: string;
  label: string;
  priceCents: number;
}

function optionsToText(options: Option[]): string {
  return options.map((option) => `${option.label}: ${option.priceCents / 100}`).join("\n");
}

function textToOptions(text: string): Option[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line, index) => {
      const [rawLabel, rawPrice] = line.split(":");
      const label = (rawLabel ?? "").trim();
      const price = Number((rawPrice ?? "0").trim());
      const key =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 30) || `option_${index + 1}`;
      return { key, label: label || `Option ${index + 1}`, priceCents: Math.round(price * 100) };
    });
}

interface FormState {
  serviceId: string | null;
  name: string;
  description: string;
  pricingType: string;
  priceDollars: string;
  durationMinutes: string;
  schedulingType: string;
  recurringOptions: string;
  tierLabel: string;
  tiers: string;
  extras: string;
  active: boolean;
  sortOrder: string;
}

const EMPTY: FormState = {
  serviceId: null,
  name: "",
  description: "",
  pricingType: "fixed",
  priceDollars: "",
  durationMinutes: "60",
  schedulingType: "time_slot",
  recurringOptions: "",
  tierLabel: "Size",
  tiers: "",
  extras: "",
  active: true,
  sortOrder: "0",
};

function fromService(service: ServiceView): FormState {
  const config = service.pricingConfig;
  return {
    serviceId: service.id,
    name: service.name,
    description: service.description ?? "",
    pricingType: service.pricingType,
    priceDollars: service.priceCents === null ? "" : String(service.priceCents / 100),
    durationMinutes: service.durationMinutes === null ? "" : String(service.durationMinutes),
    schedulingType: service.schedulingType,
    recurringOptions: (service.recurringOptions as string[]).join(", "),
    tierLabel: config.tierLabel ?? "Size",
    tiers: optionsToText(config.tiers ?? []),
    extras: optionsToText(config.extras ?? []),
    active: service.active,
    sortOrder: String(service.sortOrder),
  };
}

export function ServicesEditor({
  businessId,
  services,
  onChanged,
}: {
  businessId: string;
  services: ServiceView[];
  onChanged: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);

    const needsPrice = form.pricingType === "fixed" || form.pricingType === "from";
    if (needsPrice && form.priceDollars.trim() === "") {
      setBusy(false);
      setResult({ status: "invalid", message: "Add a price in dollars, e.g. 85." });
      return;
    }
    const tiers = textToOptions(form.tiers);
    const extras = textToOptions(form.extras);
    if (form.pricingType === "tiered" && tiers.length === 0) {
      setBusy(false);
      setResult({ status: "invalid", message: "A tiered service needs at least one tier." });
      return;
    }
    const seen = new Set<string>();
    for (const option of [...tiers, ...extras]) {
      if (seen.has(option.key)) {
        setBusy(false);
        setResult({ status: "invalid", message: `Two options share the name "${option.label}".` });
        return;
      }
      seen.add(option.key);
    }

    const existing = services.find((service) => service.id === form.serviceId);

    try {
      const response = await saveService({
        data: {
          businessId,
          serviceId: form.serviceId,
          service: {
            name: form.name,
            ...(form.description.trim() === "" ? {} : { description: form.description }),
            active: form.active,
            pricingType: form.pricingType as (typeof PRICING_TYPES)[number],
            priceCents:
              needsPrice && form.priceDollars.trim() !== ""
                ? Math.round(Number(form.priceDollars) * 100)
                : null,
            pricingConfig: { tierLabel: form.tierLabel, tiers, extras },
            durationMinutes: form.durationMinutes === "" ? null : Number(form.durationMinutes),
            schedulingType: form.schedulingType as (typeof SCHEDULING_TYPES)[number],
            recurringOptions: form.recurringOptions
              .split(",")
              .map((value) => value.trim())
              .filter((value) => value !== ""),
            intakeFields: (existing?.intakeFields ?? []) as never,
            sortOrder: Number(form.sortOrder) || 0,
          },
        },
      });
      setResult(response);
      if (response.status === "ok") {
        setForm(EMPTY);
        await onChanged();
      }
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(service: ServiceView) {
    const response = await setServiceActive({
      data: { businessId, serviceId: service.id, active: !service.active },
    });
    setResult(response);
    if (response.status === "ok") await onChanged();
  }

  const needsPrice = form.pricingType === "fixed" || form.pricingType === "from";

  return (
    <div>
      {services.length === 0 ? (
        <p className="muted">
          No services yet. Add one below, or apply a trade template in the setup wizard.
        </p>
      ) : (
        <div className="list">
          {services.map((service) => (
            <div className="row" key={service.id}>
              <div>
                <h3>
                  {service.name}{" "}
                  {service.active ? null : <Pill tone="warn">switched off</Pill>}
                </h3>
                <p className="meta">
                  {pricingSummary(service)} ·{" "}
                  {service.schedulingType === "time_slot"
                    ? "booked into a time slot"
                    : service.schedulingType === "day_window"
                      ? "booked into a day"
                      : "owner confirms"}
                  {service.durationMinutes ? ` · ${service.durationMinutes} min` : ""}
                </p>
              </div>
              <div className="actions" style={{ marginTop: 0 }}>
                <button type="button" className="secondary" onClick={() => setForm(fromService(service))}>
                  Edit
                </button>
                <button type="button" className="secondary" onClick={() => void toggleActive(service)}>
                  {service.active ? "Switch off" : "Switch on"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: "2rem" }}>
        {form.serviceId ? "Edit service" : "Add a service"}
      </h2>
      <ResultNotice result={result} />
      <form className="form narrow" onSubmit={onSubmit}>
        <label>
          Name
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </label>
        <label>
          What it includes (optional)
          <textarea
            maxLength={500}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </label>
        <label>
          How is it priced?
          <select value={form.pricingType} onChange={(event) => set("pricingType", event.target.value)}>
            <option value="fixed">A fixed price</option>
            <option value="from">From a price</option>
            <option value="tiered">By size or package</option>
            <option value="quote_only">Quoted after a request</option>
          </select>
        </label>

        {needsPrice ? (
          <label>
            Price in dollars
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.priceDollars}
              onChange={(event) => set("priceDollars", event.target.value)}
            />
          </label>
        ) : null}

        {form.pricingType === "tiered" ? (
          <>
            <label>
              What the sizes are called
              <input
                type="text"
                maxLength={40}
                value={form.tierLabel}
                onChange={(event) => set("tierLabel", event.target.value)}
              />
            </label>
            <label>
              Sizes or packages, one per line: “Small: 60”
              <textarea
                value={form.tiers}
                onChange={(event) => set("tiers", event.target.value)}
              />
            </label>
            <label>
              Extras, one per line: “Hedge trim: 40”
              <textarea
                value={form.extras}
                onChange={(event) => set("extras", event.target.value)}
              />
            </label>
          </>
        ) : null}

        <label>
          How long does it take?
          <select
            value={form.durationMinutes}
            onChange={(event) => set("durationMinutes", event.target.value)}
          >
            {["", "15", "30", "45", "60", "90", "120", "180", "240", "300"].map((minutes) => (
              <option key={minutes || "none"} value={minutes}>
                {minutes === "" ? "Not sure" : `${minutes} minutes`}
              </option>
            ))}
          </select>
        </label>
        <label>
          How is it scheduled?
          <select
            value={form.schedulingType}
            onChange={(event) => set("schedulingType", event.target.value)}
          >
            <option value="time_slot">A time slot in the day</option>
            <option value="day_window">A day, not a time</option>
            <option value="owner_confirms">A request the owner confirms</option>
          </select>
        </label>
        <label>
          Repeat options (optional, separated by commas)
          <input
            type="text"
            placeholder="weekly, fortnightly"
            value={form.recurringOptions}
            onChange={(event) => set("recurringOptions", event.target.value)}
          />
        </label>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => set("active", event.target.checked)}
          />
          Available to the assistant
        </label>

        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : form.serviceId ? "Save changes" : "Add service"}
          </button>
          {form.serviceId ? (
            <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <p className="muted">
        Prices are AUD, and that is what the assistant quotes — it never invents one.
      </p>
    </div>
  );
}
