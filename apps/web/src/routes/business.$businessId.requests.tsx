/**
 * Job requests: work the assistant could not book itself, with the owner's own
 * price and status. A request is never a booking — the owner decides.
 */

import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";

import { JOB_REQUEST_STATUSES, type JobRequestStatus } from "@webina/shared";
import { fetchJobRequests, fetchSettings, updateJobRequest } from "~/server/dashboard";
import { Pill, ResultNotice, formatDateTime, money, type AnyResult } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/requests")({
  loader: async ({ params }) => ({
    requests: await fetchJobRequests({ data: { businessId: params.businessId } }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: RequestsPage,
});

function RequestsPage() {
  const { requests, settings } = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();
  const [result, setResult] = useState<AnyResult | null>(null);

  if (requests.status !== "ok" || settings.status !== "ok") {
    return <ResultNotice result={requests.status === "ok" ? settings : requests} />;
  }

  const timezone = settings.data.timezone;

  async function save(requestId: string, status: JobRequestStatus, ownerPriceCents: number | null) {
    const response = await updateJobRequest({ data: { businessId, requestId, status, ownerPriceCents } });
    setResult(response);
    if (response.status === "ok") await router.invalidate();
  }

  return (
    <div>
      <h2>Job requests</h2>
      <p className="muted">
        Jobs the assistant passed to you instead of booking: out of area, too big, or needing a
        price only you can give.
      </p>
      <ResultNotice result={result} />

      {requests.data.length === 0 ? (
        <p className="muted">No requests yet.</p>
      ) : (
        <div className="list">
          {requests.data.map((request) => (
            <RequestRow
              key={request.id}
              businessId={businessId}
              timezone={timezone}
              request={request}
              onSave={save}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestRow({
  businessId,
  timezone,
  request,
  onSave,
}: {
  businessId: string;
  timezone: string;
  request: {
    id: string;
    customerName: string;
    customerPhone: string;
    serviceName: string | null;
    address: string | null;
    requestedDateWindow: string | null;
    status: string;
    ownerPriceCents: number | null;
    photos: string[];
    intakeAnswers: Record<string, string>;
    conversationId: string | null;
    createdAt: Date;
  };
  onSave: (requestId: string, status: JobRequestStatus, ownerPriceCents: number | null) => Promise<void>;
}) {
  const [status, setStatus] = useState<JobRequestStatus>(request.status as JobRequestStatus);
  const [price, setPrice] = useState(
    request.ownerPriceCents === null ? "" : String(request.ownerPriceCents / 100),
  );
  const [busy, setBusy] = useState(false);

  return (
    <div className="row">
      <div>
        <h3>
          {request.customerName} · {request.serviceName ?? "Job"}{" "}
          <Pill tone={request.status === "new" ? "warn" : undefined}>{request.status}</Pill>
        </h3>
        <p className="meta">
          {request.customerPhone}
          {request.address ? ` · ${request.address}` : ""}
          {request.requestedDateWindow ? ` · wants ${request.requestedDateWindow}` : ""} · asked{" "}
          {formatDateTime(request.createdAt, timezone)}
        </p>
        {Object.keys(request.intakeAnswers).length > 0 ? (
          <p className="meta">
            {Object.entries(request.intakeAnswers)
              .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`)
              .join(" · ")}
          </p>
        ) : null}
        {request.photos.length > 0 ? <p className="meta">{request.photos.length} photo(s)</p> : null}
        {request.conversationId ? (
          <p className="meta">
            <Link
              to="/business/$businessId/conversations/$conversationId"
              params={{ businessId, conversationId: request.conversationId }}
            >
              Open the conversation
            </Link>
          </p>
        ) : null}
      </div>
      <div className="actions" style={{ marginTop: 0, alignItems: "center" }}>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as JobRequestStatus)}>
            {JOB_REQUEST_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Your price (A$)
          <input
            type="number"
            min={0}
            step="0.01"
            style={{ width: "7rem" }}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(request.id, status, price.trim() === "" ? null : Math.round(Number(price) * 100));
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {request.ownerPriceCents === null ? null : <span className="muted">{money(request.ownerPriceCents)}</span>}
      </div>
    </div>
  );
}
