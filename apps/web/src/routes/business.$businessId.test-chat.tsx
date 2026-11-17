import { createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchOnboarding } from "~/server/dashboard";
import { TestChatPanel } from "~/components/test-chat-panel";
import { Pill, ResultNotice } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/test-chat")({
  loader: ({ params }) => fetchOnboarding({ data: { businessId: params.businessId } }),
  component: TestChatPage,
});

function TestChatPage() {
  const result = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();

  if (result.status !== "ok") return <ResultNotice result={result} />;

  return (
    <div>
      <h2>
        Test chat{" "}
        {result.data.progress.botEnabled ? (
          <Pill tone="ok">assistant on</Pill>
        ) : (
          <Pill tone="warn">assistant paused</Pill>
        )}
      </h2>
      <TestChatPanel businessId={businessId} onSent={() => router.invalidate()} />
    </div>
  );
}
