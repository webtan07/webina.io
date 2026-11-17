import { createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchInstall } from "~/server/dashboard";
import { InstallPanel } from "~/components/install-panel";
import { ResultNotice } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/install")({
  loader: ({ params }) => fetchInstall({ data: { businessId: params.businessId } }),
  component: InstallPage,
});

function InstallPage() {
  const result = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();

  if (result.status !== "ok") return <ResultNotice result={result} />;

  return (
    <div>
      <h2>Put the chat on your website</h2>
      <InstallPanel
        businessId={businessId}
        install={result.data}
        onChanged={() => router.invalidate()}
      />
    </div>
  );
}
