import { createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchServiceArea, fetchSettings } from "~/server/dashboard";
import { AreaForm } from "~/components/area-form";
import { ResultNotice } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/area")({
  loader: async ({ params }) => ({
    area: await fetchServiceArea({ data: { businessId: params.businessId } }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: AreaPage,
});

function AreaPage() {
  const { area } = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();

  if (area.status !== "ok") return <ResultNotice result={area} />;

  return (
    <div>
      <h2>Service area</h2>
      <p className="muted">
        The assistant only books jobs inside this area. Outside it, it takes a job request instead
        of promising a time.
      </p>
      <AreaForm businessId={businessId} initial={area.data} onSaved={() => router.invalidate()} />
    </div>
  );
}
