/**
 * The handoffs inbox: conversations the assistant gave up on, unresolved first,
 * with the summary it wrote for the owner and a way back into the conversation.
 */

import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchHandoffs, fetchSettings, resolveHandoff } from "~/server/dashboard";
import { Pill, ResultNotice, formatDateTime, type AnyResult } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/handoffs")({
  loader: async ({ params }) => ({
    handoffs: await fetchHandoffs({ data: { businessId: params.businessId, includeResolved: true } }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: HandoffsPage,
});

function HandoffsPage() {
  const { handoffs, settings } = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();
  const [result, setResult] = useState<AnyResult | null>(null);

  if (handoffs.status !== "ok" || settings.status !== "ok") {
    return <ResultNotice result={handoffs.status === "ok" ? settings : handoffs} />;
  }

  const timezone = settings.data.timezone;
  const open = handoffs.data.filter((handoff) => !handoff.resolved);
  const resolved = handoffs.data.filter((handoff) => handoff.resolved);

  async function resolve(handoffId: string) {
    const response = await resolveHandoff({ data: { businessId, handoffId } });
    setResult(response);
    if (response.status === "ok") await router.invalidate();
  }

  return (
    <div>
      <h2>Handoffs</h2>
      <p className="muted">
        The assistant passes a conversation to you when it is unsure, a customer asks for a person,
        or the job needs your judgement. Nothing is lost — the whole conversation is kept.
      </p>
      <ResultNotice result={result} />

      <h3 style={{ marginTop: "1.5rem" }}>
        Waiting on you {open.length > 0 ? <Pill tone="warn">{open.length}</Pill> : null}
      </h3>
      {open.length === 0 ? (
        <p className="muted">Nothing waiting. Good.</p>
      ) : (
        <div className="list">
          {open.map((handoff) => (
            <div className="row" key={handoff.id}>
              <div>
                <h3>{handoff.reason.replace(/_/g, " ")}</h3>
                <p className="meta">{handoff.summary}</p>
                <p className="meta">{formatDateTime(handoff.createdAt, timezone)}</p>
              </div>
              <div className="actions" style={{ marginTop: 0 }}>
                <Link
                  to="/business/$businessId/conversations/$conversationId"
                  params={{ businessId, conversationId: handoff.conversationId }}
                  className="button secondary"
                >
                  Open conversation
                </Link>
                <button type="button" className="secondary" onClick={() => void resolve(handoff.id)}>
                  Mark done
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 ? (
        <>
          <h3 style={{ marginTop: "2rem" }}>Done</h3>
          <div className="list">
            {resolved.slice(0, 20).map((handoff) => (
              <div className="row" key={handoff.id}>
                <div>
                  <h3>{handoff.reason.replace(/_/g, " ")}</h3>
                  <p className="meta">{handoff.summary}</p>
                </div>
                <Pill tone="ok">done</Pill>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
