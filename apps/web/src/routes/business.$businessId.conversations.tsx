/**
 * Every conversation the assistant has had, newest first, filterable by
 * channel and status. The filters are client-side on purpose: the list is
 * capped at 50 rows, so there is nothing to gain from a round trip.
 */

import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { fetchConversations, fetchSettings } from "~/server/dashboard";
import { Pill, ResultNotice, formatDateTime } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/conversations")({
  loader: async ({ params }) => ({
    conversations: await fetchConversations({ data: { businessId: params.businessId } }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: ConversationsPage,
});

function ConversationsPage() {
  const { conversations, settings } = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");

  if (conversations.status !== "ok" || settings.status !== "ok") {
    return <ResultNotice result={conversations.status === "ok" ? settings : conversations} />;
  }

  const timezone = settings.data.timezone;
  const rows = conversations.data.filter(
    (row) =>
      (channel === "all" || row.channel === channel) && (status === "all" || row.status === status),
  );

  return (
    <div>
      <h2>Conversations</h2>
      <div className="toolbar">
        <label>
          Channel
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="all">All</option>
            <option value="web">Web chat</option>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All</option>
            <option value="active">With the assistant</option>
            <option value="handed_off">With you</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          No conversations match. When a customer uses the chat on your site, it appears here.
        </p>
      ) : (
        <div className="list">
          {rows.map((row) => (
            <div className="row" key={row.id}>
              <div>
                <h3>
                  <Link
                    to="/business/$businessId/conversations/$conversationId"
                    params={{ businessId, conversationId: row.id }}
                  >
                    {row.channel === "web" ? "Website chat" : row.channel.toUpperCase()} ·{" "}
                    {formatDateTime(row.lastMessageAt, timezone)}
                  </Link>{" "}
                  {row.openHandoff ? <Pill tone="warn">needs you</Pill> : null}
                </h3>
                <p className="meta">
                  {row.messageCount} messages · started {formatDateTime(row.startedAt, timezone)}
                </p>
              </div>
              <Pill tone={row.status === "handed_off" ? "warn" : undefined}>
                {row.status.replace(/_/g, " ")}
              </Pill>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
