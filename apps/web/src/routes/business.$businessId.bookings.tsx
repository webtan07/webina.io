/**
 * Bookings: a day view, what is coming up, and the owner's own "add a booking".
 *
 * A booking added here goes through the same slot arithmetic as one the
 * assistant makes, so the two can never double-book a slot between them.
 */

import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";

import {
  changeBookingStatus,
  createBooking,
  fetchBookings,
  fetchServices,
  fetchSettings,
} from "~/server/dashboard";
import { Pill, ResultNotice, formatDateTime, formatDay, money, todayIn, type AnyResult } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/bookings")({
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === "string" ? search.date : "",
  }),
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: async ({ params, deps }) => ({
    bookings: await fetchBookings({ data: { businessId: params.businessId, date: deps.date } }),
    services: await fetchServices({ data: { businessId: params.businessId } }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: BookingsPage,
});

function BookingsPage() {
  const { bookings, services, settings } = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [result, setResult] = useState<AnyResult | null>(null);

  if (bookings.status !== "ok" || services.status !== "ok" || settings.status !== "ok") {
    const failed = bookings.status !== "ok" ? bookings : services.status !== "ok" ? services : settings;
    return <ResultNotice result={failed} />;
  }

  const timezone = settings.data.timezone;
  const date = search.date === "" ? todayIn(timezone) : search.date;
  const activeServices = services.data.filter((service) => service.active);

  async function setStatus(bookingId: string, status: "confirmed" | "completed" | "cancelled" | "no_show") {
    const response = await changeBookingStatus({ data: { businessId, bookingId, status } });
    setResult(response);
    if (response.status === "ok") await router.invalidate();
  }

  return (
    <div>
      <h2>Bookings</h2>
      <div className="toolbar">
        <label>
          Day
          <input
            type="date"
            value={date}
            onChange={(event) =>
              void navigate({
                to: "/business/$businessId/bookings",
                params: { businessId },
                search: { date: event.target.value },
              })
            }
          />
        </label>
        <span className="muted">{formatDay(date, timezone)}</span>
      </div>

      <ResultNotice result={result} />

      {bookings.data.day.length === 0 ? (
        <p className="muted">Nothing booked on this day.</p>
      ) : (
        <div className="list">
          {bookings.data.day.map((booking) => (
            <div className="row" key={booking.id}>
              <div>
                <h3>
                  {booking.customerName} · {booking.serviceName ?? "Service"}{" "}
                  <Pill tone={booking.status === "cancelled" ? "danger" : undefined}>
                    {booking.status.replace(/_/g, " ")}
                  </Pill>
                </h3>
                <p className="meta">
                  {formatDateTime(booking.startAt, timezone)} · {booking.customerPhone}
                  {booking.priceCentsSnapshot === null
                    ? ""
                    : ` · ${money(booking.priceCentsSnapshot)}`}
                  {booking.address ? ` · ${booking.address}` : ""}
                </p>
                {booking.notes ? <p className="meta">{booking.notes}</p> : null}
              </div>
              <div className="actions" style={{ marginTop: 0 }}>
                {booking.conversationId ? (
                  <Link
                    to="/business/$businessId/conversations/$conversationId"
                    params={{ businessId, conversationId: booking.conversationId }}
                    className="button secondary"
                  >
                    Conversation
                  </Link>
                ) : null}
                {booking.status === "confirmed" ? (
                  <>
                    <button type="button" className="secondary" onClick={() => void setStatus(booking.id, "completed")}>
                      Done
                    </button>
                    <button type="button" className="secondary" onClick={() => void setStatus(booking.id, "cancelled")}>
                      Cancel
                    </button>
                    <button type="button" className="secondary" onClick={() => void setStatus(booking.id, "no_show")}>
                      No-show
                    </button>
                  </>
                ) : (
                  <button type="button" className="secondary" onClick={() => void setStatus(booking.id, "confirmed")}>
                    Reinstate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: "2rem" }}>Coming up</h2>
      {bookings.data.upcoming.length === 0 ? (
        <p className="muted">No confirmed bookings ahead.</p>
      ) : (
        <div className="list">
          {bookings.data.upcoming.slice(0, 10).map((booking) => (
            <div className="row" key={`upcoming-${booking.id}`}>
              <div>
                <h3>
                  {booking.customerName} · {booking.serviceName ?? "Service"}
                </h3>
                <p className="meta">{formatDateTime(booking.startAt, timezone)}</p>
              </div>
              <Pill>{booking.source === "dashboard" ? "added by you" : "booked by the assistant"}</Pill>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: "2rem" }}>Add a booking</h2>
      <ManualBookingForm
        businessId={businessId}
        date={date}
        services={activeServices.map((service) => ({
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          priceCents: service.priceCents,
        }))}
        onCreated={() => router.invalidate()}
      />
    </div>
  );
}

function ManualBookingForm({
  businessId,
  date,
  services,
  onCreated,
}: {
  businessId: string;
  date: string;
  services: { id: string; name: string; durationMinutes: number | null; priceCents: number | null }[];
  onCreated: () => void | Promise<void>;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [startTime, setStartTime] = useState("09:00");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = services.find((service) => service.id === serviceId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await createBooking({
        data: {
          businessId,
          serviceId,
          date,
          startTime,
          durationMinutes: chosen?.durationMinutes ?? 60,
          customerName,
          customerPhone,
          priceCents: chosen?.priceCents ?? null,
        },
      });
      setResult(response);
      if (response.status === "ok") {
        setCustomerName("");
        setCustomerPhone("");
        setNotes("");
        await onCreated();
      }
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  if (services.length === 0) {
    return (
      <p className="muted">
        Add a service first —{" "}
        <Link to="/business/$businessId/services" params={{ businessId }}>
          services and prices
        </Link>
        .
      </p>
    );
  }

  return (
    <form className="form narrow" onSubmit={onSubmit}>
      <ResultNotice result={result} />
      <label>
        Service
        <select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
              {service.priceCents === null ? "" : ` · ${money(service.priceCents)}`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start time on {date}
        <input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      </label>
      <label>
        Customer name
        <input type="text" required minLength={2} value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
      </label>
      <label>
        Phone
        <input type="tel" required value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
      </label>
      <label>
        Notes (optional)
        <input type="text" maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add booking"}
        </button>
      </div>
    </form>
  );
}
