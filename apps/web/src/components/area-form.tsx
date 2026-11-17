/**
 * The service-area editor: where the business will travel to.
 *
 * "Everywhere" is the honest default for a new tenant, and it is what the
 * assistant treats a missing area as. The other three types are the ones the
 * agent can actually check a customer's suburb, postcode or distance against.
 */

import { useState, type FormEvent } from "react";

import { SERVICE_AREA_TYPES } from "@webina/shared";
import type { ServiceAreaRecord } from "@webina/db";

import { saveServiceArea } from "~/server/dashboard";
import { ResultNotice, type AnyResult } from "~/components/ui";

const TYPE_LABELS: Record<string, string> = {
  none: "Everywhere (no limit)",
  suburb_list: "A list of suburbs",
  postcode_list: "A list of postcodes",
  radius: "A distance around a point",
};

export function AreaForm({
  businessId,
  initial,
  onSaved,
}: {
  businessId: string;
  initial: ServiceAreaRecord;
  onSaved?: () => void | Promise<void>;
}) {
  const [type, setType] = useState(initial.type);
  const [values, setValues] = useState(initial.values.join(", "));
  const [centreLat, setCentreLat] = useState(initial.centerLat === null ? "" : String(initial.centerLat));
  const [centreLng, setCentreLng] = useState(initial.centerLng === null ? "" : String(initial.centerLng));
  const [radiusKm, setRadiusKm] = useState(initial.radiusKm === null ? "25" : String(initial.radiusKm));
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setResult(null);

    const list = values
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");

    if (type === "suburb_list" && list.length === 0) {
      setBusy(false);
      setResult({ status: "invalid", message: "Add at least one suburb." });
      return;
    }
    if (type === "postcode_list" && list.some((value) => !/^\d{4}$/.test(value))) {
      setBusy(false);
      setResult({ status: "invalid", message: "Australian postcodes are four digits, e.g. 5000." });
      return;
    }
    if (type === "radius" && (centreLat === "" || centreLng === "")) {
      setBusy(false);
      setResult({ status: "invalid", message: "A distance needs a centre point and a radius." });
      return;
    }

    try {
      const response = await saveServiceArea({
        data: {
          businessId,
          area: {
            type: type as (typeof SERVICE_AREA_TYPES)[number],
            values: list,
            centerLat: centreLat === "" ? null : Number(centreLat),
            centerLng: centreLng === "" ? null : Number(centreLng),
            radiusKm: radiusKm === "" ? null : Number(radiusKm),
          },
        },
      });
      setResult(response);
      if (response.status === "ok") {
        setSaved(true);
        await onSaved?.();
      }
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <ResultNotice result={result} />
      {saved ? <div className="notice ok">Saved.</div> : null}

      <label>
        Where do you work?
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {SERVICE_AREA_TYPES.map((option) => (
            <option key={option} value={option}>
              {TYPE_LABELS[option] ?? option}
            </option>
          ))}
        </select>
      </label>

      {type === "suburb_list" || type === "postcode_list" ? (
        <label>
          {type === "suburb_list" ? "Suburbs, separated by commas" : "Postcodes, separated by commas"}
          <textarea value={values} onChange={(event) => setValues(event.target.value)} />
        </label>
      ) : null}

      {type === "radius" ? (
        <>
          <label>
            Centre latitude
            <input
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              value={centreLat}
              onChange={(event) => setCentreLat(event.target.value)}
            />
          </label>
          <label>
            Centre longitude
            <input
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              value={centreLng}
              onChange={(event) => setCentreLng(event.target.value)}
            />
          </label>
          <label>
            How far, in kilometres?
            <input
              type="number"
              min={1}
              max={500}
              value={radiusKm}
              onChange={(event) => setRadiusKm(event.target.value)}
            />
          </label>
        </>
      ) : null}

      <p className="muted">
        The assistant only books inside this area. Anything outside becomes a job request.
      </p>

      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save service area"}
        </button>
      </div>
    </form>
  );
}
