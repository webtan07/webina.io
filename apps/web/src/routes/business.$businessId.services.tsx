import { createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchServices } from "~/server/dashboard";
import { ServicesEditor } from "~/components/services-editor";
import { ResultNotice } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/services")({
  loader: ({ params }) => fetchServices({ data: { businessId: params.businessId } }),
  component: ServicesPage,
});

function ServicesPage() {
  const result = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();

  if (result.status !== "ok") return <ResultNotice result={result} />;

  return (
    <div>
      <h2>Services and prices</h2>
      <p className="muted">
        This is the whole price list the assistant is allowed to quote from. Anything not here
        becomes a job request.
      </p>
      <ServicesEditor
        businessId={businessId}
        services={result.data}
        onChanged={() => router.invalidate()}
      />
    </div>
  );
}
