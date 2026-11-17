import { createFileRoute, useRouter } from "@tanstack/react-router";

import { fetchHours, fetchSettings } from "~/server/dashboard";
import { HoursForm } from "~/components/hours-form";
import { ResultNotice } from "~/components/ui";

export const Route = createFileRoute("/business/$businessId/hours")({
  loader: async ({ params }) => ({
    hours: await fetchHours({ data: { businessId: params.businessId } }),
    settings: await fetchSettings({ data: { businessId: params.businessId } }),
  }),
  component: HoursPage,
});

function HoursPage() {
  const { hours, settings } = Route.useLoaderData();
  const { businessId } = Route.useParams();
  const router = useRouter();

  if (hours.status !== "ok" || settings.status !== "ok") {
    return <ResultNotice result={hours.status === "ok" ? settings : hours} />;
  }

  return (
    <div>
      <h2>Opening hours</h2>
      <p className="muted">
        The assistant only offers times inside these hours, in {settings.data.timezone}.
      </p>
      <HoursForm
        businessId={businessId}
        initialRules={hours.data.rules}
        initialExceptions={hours.data.exceptions}
        timezone={settings.data.timezone}
        onSaved={() => router.invalidate()}
      />
    </div>
  );
}
