/**
 * Opening hours: the weekly pattern the assistant may book inside, plus the
 * one-off exceptions (a public holiday, a late finish, a day off).
 *
 * The whole week is saved as one grid, because that is how an owner thinks
 * about it — and `replaceAvailabilityRules` swaps it in one transaction.
 */

import { useState, type FormEvent } from "react";

import type { AvailabilityExceptionRecord, AvailabilityRuleRecord } from "@webina/db";

import { saveException, saveHours } from "~/server/dashboard";
import { ResultNotice, WEEKDAYS, formatDay, todayIn, type AnyResult } from "~/components/ui";

interface DayState {
  enabled: boolean;
  start: string;
  end: string;
  slotMinutes: string;
  capacity: string;
}

function initialDays(rules: AvailabilityRuleRecord[]): DayState[] {
  return WEEKDAYS.map((_, weekday) => {
    const rule = rules.find((candidate) => candidate.weekday === weekday);
    return {
      enabled: rule !== undefined,
      start: rule?.startTime ?? "09:00",
      end: rule?.endTime ?? "17:00",
      slotMinutes: String(rule?.slotMinutes ?? 60),
      capacity: String(rule?.capacity ?? 1),
    };
  });
}

export function HoursForm({
  businessId,
  initialRules,
  initialExceptions,
  timezone,
  onSaved,
}: {
  businessId: string;
  initialRules: AvailabilityRuleRecord[];
  initialExceptions: AvailabilityExceptionRecord[];
  timezone: string;
  onSaved?: () => void | Promise<void>;
}) {
  const [days, setDays] = useState<DayState[]>(() => initialDays(initialRules));
  const [result, setResult] = useState<AnyResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [exceptionDate, setExceptionDate] = useState(todayIn(timezone));
  const [exceptionClosed, setExceptionClosed] = useState(true);
  const [exceptionStart, setExceptionStart] = useState("09:00");
  const [exceptionEnd, setExceptionEnd] = useState("12:00");
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionResult, setExceptionResult] = useState<AnyResult | null>(null);

  function updateDay(weekday: number, patch: Partial<DayState>) {
    setDays((current) =>
      current.map((day, index) => (index === weekday ? { ...day, ...patch } : day)),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setResult(null);

    const rules = days
      .map((day, weekday) => ({ day, weekday }))
      .filter(({ day }) => day.enabled)
      .map(({ day, weekday }) => ({
        weekday,
        startTime: day.start,
        endTime: day.end,
        slotMinutes: Number(day.slotMinutes) || 60,
        capacity: Number(day.capacity) || 1,
      }));

    if (rules.some((rule) => rule.endTime <= rule.startTime)) {
      setBusy(false);
      setResult({ status: "invalid", message: "Each day's finish time must be after its start time." });
      return;
    }

    try {
      const response = await saveHours({ data: { businessId, rules } });
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

  async function onAddException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExceptionResult(null);
    try {
      const response = await saveException({
        data: {
          businessId,
          exception: {
            date: exceptionDate,
            closed: exceptionClosed,
            ...(exceptionClosed
              ? {}
              : { startTime: exceptionStart, endTime: exceptionEnd }),
            ...(exceptionReason.trim() === "" ? {} : { reason: exceptionReason.trim() }),
          },
        },
      });
      setExceptionResult(response);
      if (response.status === "ok") await onSaved?.();
    } catch (error) {
      setExceptionResult({
        status: "error",
        message: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  return (
    <div>
      <form className="form narrow" onSubmit={onSubmit}>
        <ResultNotice result={result} />
        {saved ? <div className="notice ok">Hours saved.</div> : null}

        <div className="weekday-grid">
          {WEEKDAYS.map((label, weekday) => {
            const day = days[weekday];
            if (!day) return null;
            return (
              <div className="day" key={label}>
                <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) => updateDay(weekday, { enabled: event.target.checked })}
                  />
                  {label}
                </label>
                <input
                  type="time"
                  value={day.start}
                  disabled={!day.enabled}
                  onChange={(event) => updateDay(weekday, { start: event.target.value })}
                  aria-label={`${label} opens`}
                />
                <input
                  type="time"
                  value={day.end}
                  disabled={!day.enabled}
                  onChange={(event) => updateDay(weekday, { end: event.target.value })}
                  aria-label={`${label} closes`}
                />
                <label className="slot">
                  <span className="muted">Slot</span>
                  <select
                    value={day.slotMinutes}
                    disabled={!day.enabled}
                    onChange={(event) => updateDay(weekday, { slotMinutes: event.target.value })}
                    aria-label={`${label} appointment length`}
                  >
                    {["15", "30", "45", "60", "90", "120"].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>

        <p className="muted">
          Times are in {timezone}. The assistant only offers slots inside these hours.
        </p>

        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save hours"}
          </button>
        </div>
      </form>

      <h2 style={{ marginTop: "2rem" }}>Days off and one-off hours</h2>
      <ResultNotice result={exceptionResult} />
      <form className="form narrow" onSubmit={onAddException}>
        <label>
          Date
          <input
            type="date"
            required
            value={exceptionDate}
            onChange={(event) => setExceptionDate(event.target.value)}
          />
        </label>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={exceptionClosed}
            onChange={(event) => setExceptionClosed(event.target.checked)}
          />
          Closed all day
        </label>
        {exceptionClosed ? null : (
          <>
            <label>
              Opens
              <input
                type="time"
                value={exceptionStart}
                onChange={(event) => setExceptionStart(event.target.value)}
              />
            </label>
            <label>
              Closes
              <input
                type="time"
                value={exceptionEnd}
                onChange={(event) => setExceptionEnd(event.target.value)}
              />
            </label>
          </>
        )}
        <label>
          Reason (optional)
          <input
            type="text"
            maxLength={120}
            value={exceptionReason}
            onChange={(event) => setExceptionReason(event.target.value)}
          />
        </label>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="submit" className="secondary">
            Save this day
          </button>
        </div>
      </form>

      {initialExceptions.length === 0 ? (
        <p className="muted">No exceptions yet.</p>
      ) : (
        <div className="list">
          {initialExceptions.map((exception) => (
            <div className="row" key={exception.date}>
              <div>
                <h3>{formatDay(exception.date, timezone)}</h3>
                <p className="meta">
                  {exception.closed
                    ? "Closed"
                    : `${exception.startTime ?? ""}–${exception.endTime ?? ""}`}
                  {exception.reason ? ` · ${exception.reason}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
