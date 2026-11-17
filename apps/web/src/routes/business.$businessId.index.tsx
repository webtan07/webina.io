/** The overview: what happened, and the one thing to do next. */

import { Link, createFileRoute } from "@tanstack/react-router";

import { fetchConversations, fetchOnboarding } from "~/server/dashboard";
import { nextStep, setupSteps } from "~/components/steps";
import { Pill, ResultNotice, Stat, formatDateTime } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/")({
  loader: async ({ params }) => {
    const businessId = params.businessId;
    const [onboarding, conversations] = [
      await fetchOnboarding({ data: { businessId } }),
      await fetchConversations({ data: { businessId } }),
    ];
    return { onboarding, conversations };
  },
  component: OverviewPage,
});

function OverviewPage() {
  const { onboarding, conversations } = Route.useLoaderData();
  const { businessId } = Route.useParams();

  if (onboarding.status !== "ok") return <ResultNotice result={onboarding} />;

  const { progress, summary, missingForLive, timezone } = onboarding.data;
  const steps = setupSteps(progress);
  const next = nextStep(steps);
  const done = steps.filter((step) => step.done).length;
  const recent = conversations.status === "ok" ? conversations.data.slice(0, 5) : [];

  return (
    <div>
      {progress.status === "active" && progress.botEnabled ? (
        <div className="notice ok">
          Your assistant is live. Conversations, bookings and handoffs appear here as they happen.
        </div>
      ) : (
        <div className="notice ok">
          <strong>
            Setup {done} of {steps.length} done.
          </strong>{" "}
          {next ? (
            <>
              Next: {next.title}.{" "}
              <Link to={next.href} params={{ businessId }}>
                Do it now
              </Link>
            </>
          ) : (
            <>
              Everything is ready —{" "}
              <Link to="/business/$businessId/onboarding" params={{ businessId }}>
                go live
              </Link>
              .
            </>
          )}
        </div>
      )}

      <div className="grid" style={{ marginBottom: "1.5rem" }}>
        <Stat label="conversations in the last 7 days" value={summary.conversations7d} />
        <Stat label="bookings coming up" value={summary.upcomingBookings} />
        <Stat label="new job requests" value={summary.newRequests} />
        <Stat label="waiting on you" value={summary.openHandoffs} />
        <Stat label="active services" value={summary.activeServices} />
      </div>

      {missingForLive.length > 0 ? (
        <p className="muted">
          Before going live you still need {missingForLive.join(", ")}.
        </p>
      ) : null}

      <h2>Recent conversations</h2>
      {recent.length === 0 ? (
        <p className="muted">
          Nothing yet.{" "}
          <Link to="/business/$businessId/test-chat" params={{ businessId }}>
            Try the test chat
          </Link>{" "}
          to see what a customer sees.
        </p>
      ) : (
        <div className="list">
          {recent.map((conversation) => (
            <div className="row" key={conversation.id}>
              <div>
                <h3>
                  <Link
                    to="/business/$businessId/conversations/$conversationId"
                    params={{ businessId, conversationId: conversation.id }}
                  >
                    {conversation.channel} conversation
                  </Link>{" "}
                  {conversation.openHandoff ? <Pill tone="warn">needs you</Pill> : null}
                </h3>
                <p className="meta">
                  {conversation.messageCount} messages · last activity{" "}
                  {formatDateTime(conversation.lastMessageAt, timezone)}
                </p>
              </div>
              <Pill>{conversation.status.replace(/_/g, " ")}</Pill>
            </div>
          ))}
        </div>
      )}

      <div className="actions">
        <Link to="/business/$businessId/onboarding" params={{ businessId }} className="button">
          Open setup
        </Link>
        <Link to="/business/$businessId/install" params={{ businessId }} className="button secondary">
          Install the chat
        </Link>
      </div>
    </div>
  );
}
