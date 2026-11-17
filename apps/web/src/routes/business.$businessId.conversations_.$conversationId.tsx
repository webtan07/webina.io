/**
 * One conversation: what the customer said, what the assistant said, and every
 * tool it called — summarised, never as raw JSON.
 *
 * "Take over" marks the conversation as yours: the assistant stops answering it
 * (the agent loop checks the status before it calls the model) and it shows as
 * "with you" in the list. "Hand back" returns it.
 */

import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchConversation, fetchSettings, setConversationStatus } from "~/server/dashboard";
import { Pill, ResultNotice, formatDateTime, type AnyResult } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/conversations_/$conversationId")({
  loader: async ({ params }) => ({
    conversation: await fetchConversation({
      data: { businessId: params.businessId, conversationId: params.conversationId },
    }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversation, settings } = Route.useLoaderData();
  const { businessId, conversationId } = Route.useParams();
  const router = useRouter();
  const [result, setResult] = useState<AnyResult | null>(null);

  if (conversation.status !== "ok" || settings.status !== "ok") {
    return <ResultNotice result={conversation.status === "ok" ? settings : conversation} />;
  }

  const timezone = settings.data.timezone;
  const detail = conversation.data;

  async function changeStatus(status: "active" | "handed_off") {
    const response = await setConversationStatus({ data: { businessId, conversationId, status } });
    setResult(response);
    if (response.status === "ok") await router.invalidate();
  }

  return (
    <div>
      <p>
        <Link to="/business/$businessId/conversations" params={{ businessId }}>
          ← All conversations
        </Link>
      </p>
      <h2>
        {detail.conversation.channel === "web" ? "Website chat" : detail.conversation.channel}{" "}
        <Pill tone={detail.conversation.status === "handed_off" ? "warn" : undefined}>
          {detail.conversation.status.replace(/_/g, " ")}
        </Pill>
      </h2>
      <p className="muted">
        Started {formatDateTime(detail.conversation.startedAt, timezone)} · last message{" "}
        {formatDateTime(detail.conversation.lastMessageAt, timezone)}
      </p>

      <ResultNotice result={result} />
      <div className="actions">
        {detail.conversation.status === "handed_off" ? (
          <button type="button" onClick={() => void changeStatus("active")}>
            Hand back to the assistant
          </button>
        ) : (
          <button type="button" onClick={() => void changeStatus("handed_off")}>
            Take over
          </button>
        )}
      </div>

      {detail.handoffs.length > 0 ? (
        <section className="card">
          <h3>Handed to you</h3>
          {detail.handoffs.map((handoff) => (
            <p key={handoff.id} className="meta">
              <strong>{handoff.reason}</strong> · {handoff.summary} ·{" "}
              {handoff.resolved ? "resolved" : "open"}
            </p>
          ))}
        </section>
      ) : null}

      <div className="chat" style={{ maxHeight: "none" }}>
        {detail.turns.length === 0 ? (
          <p className="muted">No messages in this conversation yet.</p>
        ) : (
          detail.turns.map((turn) => (
            <div className={`bubble ${turn.role === "user" ? "user" : "assistant"}`} key={turn.id}>
              {turn.text === "" ? <span className="muted">(no text)</span> : turn.text}
              {turn.tools.length > 0 ? (
                <div className="tools">
                  {turn.tools.map((tool, index) => (
                    <Pill key={`${tool.name}-${index}`}>
                      {tool.name}
                      {tool.summary === "" ? "" : ` · ${tool.summary}`}
                    </Pill>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
