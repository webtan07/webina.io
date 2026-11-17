/**
 * The tenant dashboard's server functions.
 *
 * Every function here follows the same four steps, in this order:
 *   1. validate the body with a zod schema from `@webina/shared`;
 *   2. resolve the Better Auth session behind the request's cookies (401);
 *   3. check the caller's membership of the business (403);
 *   4. do the work inside `withTenant`, so Postgres RLS scopes it as well.
 *
 * The database and the agent are imported inside the handlers on purpose: this
 * module is imported by route components, and none of that belongs in a
 * browser bundle.
 */

import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

import {
  areaSaveInput,
  bookingCreateInput,
  bookingStatusInput,
  conversationInput,
  conversationListInput,
  conversationStatusInput,
  exceptionSaveInput,
  handoffResolveInput,
  hoursSaveInput,
  installCheckInput,
  originsSaveInput,
  requestUpdateInput,
  serviceActiveInput,
  serviceSaveInput,
  settingsSaveInput,
  templateApplyInput,
  testChatInput,
  type TradeTemplate,
} from "@webina/shared";
import type {
  ApplyTemplateResult,
  AvailabilityExceptionRecord,
  AvailabilityRuleRecord,
  BookingRow,
  BusinessSettings,
  ConversationDetail,
  ConversationSummary,
  DashboardSummary,
  HandoffListItem,
  InstallCheckRecord,
  JobRequestRow,
  OnboardingProgress,
  ServiceAreaRecord,
  ServiceRecord,
} from "@webina/db";

const requestHeaders = createServerOnlyFn(async (): Promise<Headers> => {
  const { getRequestHeaders } = await import("@tanstack/react-start/server");
  return new Headers(getRequestHeaders() as unknown as Record<string, string>);
});

export type FailStatus =
  | "signed_out"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "slot_taken"
  | "error";

export type Result<T> = { status: "ok"; data: T } | { status: FailStatus; message: string };

/**
 * What actually crosses the wire.
 *
 * `ServiceRecord.pricingConfig` and `JobRequestRow.intakeAnswers` are typed
 * `Record<string, unknown>` in the database layer, which is right for the
 * agent but not serialisable in a typed server-function payload. These views
 * are the same rows with those two fields narrowed to the shapes they really
 * have, so the browser gets a type it can render instead of `unknown`.
 */
export interface PriceOptionView {
  key: string;
  label: string;
  priceCents: number;
}

export interface ServiceView {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  pricingType: string;
  priceCents: number | null;
  pricingConfig: { tierLabel: string | null; tiers: PriceOptionView[]; extras: PriceOptionView[] };
  durationMinutes: number | null;
  schedulingType: string;
  recurringOptions: string[];
  intakeFields: { key: string; question: string; type: string; required: boolean; options: string[] }[];
  sortOrder: number;
}

function optionsOf(value: unknown): PriceOptionView[] {
  if (!Array.isArray(value)) return [];
  return value.map((option) => {
    const row = option as { key?: unknown; label?: unknown; priceCents?: unknown };
    return {
      key: String(row.key ?? ""),
      label: String(row.label ?? ""),
      priceCents: Number(row.priceCents ?? 0),
    };
  });
}

function toServiceView(row: ServiceRecord): ServiceView {
  const config = row.pricingConfig as { tierLabel?: unknown; tiers?: unknown; extras?: unknown };
  const fields = Array.isArray(row.intakeFields) ? row.intakeFields : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    pricingType: row.pricingType,
    priceCents: row.priceCents,
    pricingConfig: {
      tierLabel: typeof config.tierLabel === "string" ? config.tierLabel : null,
      tiers: optionsOf(config.tiers),
      extras: optionsOf(config.extras),
    },
    durationMinutes: row.durationMinutes,
    schedulingType: row.schedulingType,
    recurringOptions: row.recurringOptions.filter((value): value is string => typeof value === "string"),
    intakeFields: fields.map((field) => {
      const row2 = field as { key?: unknown; question?: unknown; type?: unknown; required?: unknown; options?: unknown };
      return {
        key: String(row2.key ?? ""),
        question: String(row2.question ?? ""),
        type: String(row2.type ?? "text"),
        required: row2.required === true,
        options: Array.isArray(row2.options) ? row2.options.map(String) : [],
      };
    }),
    sortOrder: row.sortOrder,
  };
}

export interface JobRequestView {
  id: string;
  serviceId: string | null;
  serviceName: string | null;
  status: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string | null;
  requestedDateWindow: string | null;
  photos: string[];
  ownerPriceCents: number | null;
  intakeAnswers: Record<string, string>;
  source: string;
  conversationId: string | null;
  createdAt: Date;
}

function toJobRequestView(row: JobRequestRow): JobRequestView {
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.intakeAnswers)) {
    answers[key] = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  }
  return { ...row, intakeAnswers: answers };
}

/**
 * Authorise, then run. Anything thrown by the work is turned into a plain
 * result: the browser gets a sentence, never a stack trace or a database
 * message.
 */
async function run<T>(
  businessId: string,
  work: (access: { businessId: string; userId: string; role: string }) => Promise<T>,
): Promise<Result<T>> {
  const { requireTenantAccess, TenantAccessError } = await import("./tenant-access");
  const { DashboardError } = await import("@webina/db");
  try {
    const access = await requireTenantAccess(await requestHeaders(), businessId);
    return { status: "ok", data: await work(access) };
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return {
        status: error.status === 401 ? "signed_out" : "forbidden",
        message: error.message,
      };
    }
    if (error instanceof DashboardError) {
      return { status: error.code, message: error.message };
    }
    console.error(
      JSON.stringify({
        level: "error",
        component: "dashboard",
        event: "dashboard_action_failed",
        businessId,
        detail: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      }),
    );
    return { status: "error", message: "Something went wrong. Try again." };
  }
}

/* ------------------------------------------------------------------ *
 * Onboarding and overview
 * ------------------------------------------------------------------ */

export interface OnboardingView {
  progress: OnboardingProgress;
  summary: DashboardSummary;
  missingForLive: string[];
  businessName: string;
  timezone: string;
  templateLabel: string;
}

export const fetchOnboarding = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<OnboardingView>> =>
    run(data.businessId, async (access) => {
      const { onboardingProgress, dashboardSummary, canGoLive, getBusinessSettings } =
        await import("@webina/db");
      const { presetFor } = await import("@webina/shared");
      const [progress, summary, live, settings] = [
        await onboardingProgress(access.businessId),
        await dashboardSummary(access.businessId),
        await canGoLive(access.businessId),
        await getBusinessSettings(access.businessId),
      ];
      return {
        progress,
        summary,
        missingForLive: live.missing,
        businessName: settings.name,
        timezone: settings.timezone,
        templateLabel: presetFor(settings.tradeTemplate as TradeTemplate).label,
      };
    }),
  );

export const applyTemplate = createServerFn({ method: "POST" })
  .validator((input: unknown) => templateApplyInput.parse(input))
  .handler(async ({ data }): Promise<Result<ApplyTemplateResult>> =>
    run(data.businessId, async (access) => {
      const { applyTradeTemplate, recordAudit } = await import("@webina/db");
      const result = await applyTradeTemplate(access.businessId, data.trade, {
        replace: data.replace,
      });
      await recordAudit(access.businessId, access.userId, "template_applied", {
        trade: data.trade,
        replaced: data.replace,
      });
      return result;
    }),
  );

export const goLive = createServerFn({ method: "POST" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<{ missing: string[] }>> =>
    run(data.businessId, async (access) => {
      const { canGoLive, updateBusinessSettings, recordAudit } = await import("@webina/db");
      const live = await canGoLive(access.businessId);
      if (!live.ok) return { missing: live.missing };
      await updateBusinessSettings(access.businessId, { status: "active", botEnabled: true });
      await recordAudit(access.businessId, access.userId, "went_live");
      return { missing: [] };
    }),
  );

/* ------------------------------------------------------------------ *
 * Services, area and hours
 * ------------------------------------------------------------------ */

export const fetchServices = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<ServiceView[]>> =>
    run(data.businessId, async (access) => {
      const { listServices } = await import("@webina/db");
      return (await listServices(access.businessId, { activeOnly: false })).map(toServiceView);
    }),
  );

export const saveService = createServerFn({ method: "POST" })
  .validator((input: unknown) => serviceSaveInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ serviceId: string }>> =>
    run(data.businessId, async (access) => {
      const { createService, updateService } = await import("@webina/db");
      const saved = data.serviceId
        ? await updateService(access.businessId, data.serviceId, data.service)
        : await createService(access.businessId, data.service);
      return { serviceId: saved.id };
    }),
  );

export const setServiceActive = createServerFn({ method: "POST" })
  .validator((input: unknown) => serviceActiveInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { setServiceActive: setActive } = await import("@webina/db");
      await setActive(access.businessId, data.serviceId, data.active);
      return { ok: true } as const;
    }),
  );

export const fetchServiceArea = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<ServiceAreaRecord>> =>
    run(data.businessId, async (access) => {
      const { getServiceArea } = await import("@webina/db");
      return getServiceArea(access.businessId);
    }),
  );

export const saveServiceArea = createServerFn({ method: "POST" })
  .validator((input: unknown) => areaSaveInput.parse(input))
  .handler(async ({ data }): Promise<Result<ServiceAreaRecord>> =>
    run(data.businessId, async (access) => {
      const { setServiceArea } = await import("@webina/db");
      return setServiceArea(access.businessId, data.area);
    }),
  );

export interface HoursView {
  rules: AvailabilityRuleRecord[];
  exceptions: AvailabilityExceptionRecord[];
}

export const fetchHours = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<HoursView>> =>
    run(data.businessId, async (access) => {
      const { listAvailabilityRules, listAvailabilityExceptions } = await import("@webina/db");
      const today = new Date().toISOString().slice(0, 10);
      const [rules, exceptions] = [
        await listAvailabilityRules(access.businessId),
        await listAvailabilityExceptions(access.businessId, today, "2100-01-01"),
      ];
      return { rules, exceptions };
    }),
  );

export const saveHours = createServerFn({ method: "POST" })
  .validator((input: unknown) => hoursSaveInput.parse(input))
  .handler(async ({ data }): Promise<Result<AvailabilityRuleRecord[]>> =>
    run(data.businessId, async (access) => {
      const { replaceAvailabilityRules } = await import("@webina/db");
      return replaceAvailabilityRules(access.businessId, data.rules);
    }),
  );

export const saveException = createServerFn({ method: "POST" })
  .validator((input: unknown) => exceptionSaveInput.parse(input))
  .handler(async ({ data }): Promise<Result<AvailabilityExceptionRecord>> =>
    run(data.businessId, async (access) => {
      const { setAvailabilityException } = await import("@webina/db");
      return setAvailabilityException(access.businessId, data.exception);
    }),
  );

/* ------------------------------------------------------------------ *
 * Conversations, handoffs
 * ------------------------------------------------------------------ */

export const fetchConversations = createServerFn({ method: "GET" })
  .validator((input: unknown) => conversationListInput.parse(input))
  .handler(async ({ data }): Promise<Result<ConversationSummary[]>> =>
    run(data.businessId, async (access) => {
      const { listConversationSummaries } = await import("@webina/db");
      return listConversationSummaries(access.businessId, {
        ...(data.channel === undefined ? {} : { channel: data.channel }),
        ...(data.status === undefined ? {} : { status: data.status }),
      });
    }),
  );

export const fetchConversation = createServerFn({ method: "GET" })
  .validator((input: unknown) => conversationInput.parse(input))
  .handler(async ({ data }): Promise<Result<ConversationDetail>> =>
    run(data.businessId, async (access) => {
      const { getConversationDetail } = await import("@webina/db");
      return getConversationDetail(access.businessId, data.conversationId);
    }),
  );

export const setConversationStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => conversationStatusInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { setConversationStatusForDashboard, recordAudit } = await import("@webina/db");
      await setConversationStatusForDashboard(
        access.businessId,
        data.conversationId,
        data.status,
      );
      await recordAudit(
        access.businessId,
        access.userId,
        data.status === "active" ? "conversation_handed_back" : "conversation_taken_over",
        { conversationId: data.conversationId },
      );
      return { ok: true } as const;
    }),
  );

export const fetchHandoffs = createServerFn({ method: "GET" })
  .validator((input: { businessId: string; includeResolved?: boolean }) => input)
  .handler(async ({ data }): Promise<Result<HandoffListItem[]>> =>
    run(data.businessId, async (access) => {
      const { listHandoffInbox } = await import("@webina/db");
      return listHandoffInbox(access.businessId, { includeResolved: data.includeResolved ?? false });
    }),
  );

export const resolveHandoff = createServerFn({ method: "POST" })
  .validator((input: unknown) => handoffResolveInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { resolveHandoff: resolve } = await import("@webina/db");
      await resolve(access.businessId, data.handoffId);
      return { ok: true } as const;
    }),
  );

/* ------------------------------------------------------------------ *
 * Bookings and job requests
 * ------------------------------------------------------------------ */

export interface BookingsView {
  date: string;
  timezone: string;
  day: BookingRow[];
  upcoming: BookingRow[];
}

export const fetchBookings = createServerFn({ method: "GET" })
  .validator((input: { businessId: string; date: string }) => input)
  .handler(async ({ data }): Promise<Result<BookingsView>> =>
    run(data.businessId, async (access) => {
      const { listBookingsForDashboard, getBusinessSettings } = await import("@webina/db");
      const { zonedToUtc, addDays } = await import("@webina/agent");
      const settings = await getBusinessSettings(access.businessId);
      // "Today" is today where the business is, not where the server is.
      const localToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : localToday;
      const from = zonedToUtc(date, "00:00", settings.timezone) ?? new Date();
      const to = zonedToUtc(addDays(date, 1), "00:00", settings.timezone) ?? new Date();
      return {
        date,
        timezone: settings.timezone,
        day: await listBookingsForDashboard(access.businessId, { from, to: new Date(to.getTime() - 1) }),
        upcoming: await listBookingsForDashboard(access.businessId, { from: new Date(), limit: 20 }),
      };
    }),
  );

export const createBooking = createServerFn({ method: "POST" })
  .validator((input: unknown) => bookingCreateInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ bookingId: string }>> =>
    run(data.businessId, async (access) => {
      const { createDashboardBooking, getBusinessSettings, DashboardError } = await import(
        "@webina/db"
      );
      const { zonedToUtc } = await import("@webina/agent");
      const settings = await getBusinessSettings(access.businessId);
      const startAt = zonedToUtc(data.date, data.startTime, settings.timezone);
      if (!startAt) {
        throw new DashboardError("invalid", "that date and time could not be read");
      }
      const endAt = new Date(startAt.getTime() + data.durationMinutes * 60_000);
      const created = await createDashboardBooking(access.businessId, {
        serviceId: data.serviceId,
        startAt,
        endAt,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
        priceCents: data.priceCents ?? null,
      });
      return { bookingId: created.id };
    }),
  );

export const changeBookingStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => bookingStatusInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { updateBookingStatus } = await import("@webina/db");
      await updateBookingStatus(access.businessId, data.bookingId, data.status);
      return { ok: true } as const;
    }),
  );

export const fetchJobRequests = createServerFn({ method: "GET" })
  .validator((input: { businessId: string; status?: string }) => input)
  .handler(async ({ data }): Promise<Result<JobRequestView[]>> =>
    run(data.businessId, async (access) => {
      const { listJobRequestsForDashboard } = await import("@webina/db");
      return (
        await listJobRequestsForDashboard(access.businessId, {
          ...(data.status === undefined ? {} : { status: data.status }),
        })
      ).map(toJobRequestView);
    }),
  );

export const updateJobRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => requestUpdateInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { updateJobRequest: update } = await import("@webina/db");
      await update(access.businessId, data.requestId, {
        ...(data.status === undefined ? {} : { status: data.status }),
        ...(data.ownerPriceCents === undefined ? {} : { ownerPriceCents: data.ownerPriceCents }),
      });
      return { ok: true } as const;
    }),
  );

/* ------------------------------------------------------------------ *
 * Settings, install snippet and the install check
 * ------------------------------------------------------------------ */

export const fetchSettings = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<BusinessSettings>> =>
    run(data.businessId, async (access) => {
      const { getBusinessSettings } = await import("@webina/db");
      return getBusinessSettings(access.businessId);
    }),
  );

export const saveSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => settingsSaveInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { updateBusinessSettings, recordAudit } = await import("@webina/db");
      const { businessId, ...patch } = data;
      await updateBusinessSettings(businessId, patch);
      // The wizard reads this back to know the details step is done. No values,
      // no personal data — just the fact that it was saved, and by whom.
      await recordAudit(access.businessId, access.userId, "settings_saved", {
        fields: Object.keys(patch).sort(),
      });
      return { ok: true } as const;
    }),
  );

export const saveAllowedOrigins = createServerFn({ method: "POST" })
  .validator((input: unknown) => originsSaveInput.parse(input))
  .handler(async ({ data }): Promise<Result<{ ok: true }>> =>
    run(data.businessId, async (access) => {
      const { setAllowedOrigins } = await import("@webina/db");
      await setAllowedOrigins(access.businessId, data.siteId, data.allowedOrigins);
      return { ok: true } as const;
    }),
  );

export interface InstallView {
  sites: BusinessSettings["sites"];
  snippet: string;
  lastCheck: InstallCheckRecord | null;
}

export const fetchInstall = createServerFn({ method: "GET" })
  .validator((input: { businessId: string }) => input)
  .handler(async ({ data }): Promise<Result<InstallView>> =>
    run(data.businessId, async (access) => {
      const { getBusinessSettings, latestInstallCheck } = await import("@webina/db");
      const settings = await getBusinessSettings(access.businessId);
      const site = settings.sites[0] ?? null;
      return {
        sites: settings.sites,
        snippet: site === null ? "" : snippetFor(site.siteKey),
        lastCheck: await latestInstallCheck(access.businessId),
      };
    }),
  );

/** The embed tag the owner pastes into their site. */
export function snippetFor(siteKey: string, origin = "https://app.webina.io"): string {
  return `<script src="${origin}/webina-widget.js" data-webina-key="${siteKey}" async></script>`;
}

/** Hosts the install check must never fetch: the server's own network. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("[::1]")) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export interface InstallCheckResult {
  checked: boolean;
  found: boolean;
  url: string;
  status: number | null;
  message: string;
}

/**
 * Fetch the tenant's own website and look for the snippet.
 *
 * Only a URL the tenant has already registered can be fetched, and never a
 * private address — this is a server making an outbound request on someone
 * else's behalf, so the allow-list is the point of it, not a nicety.
 */
export const checkInstallation = createServerFn({ method: "POST" })
  .validator((input: unknown) => installCheckInput.parse(input))
  .handler(async ({ data }): Promise<Result<InstallCheckResult>> =>
    run(data.businessId, async (access) => {
      const { getBusinessSettings, recordInstallCheck } = await import("@webina/db");
      const settings = await getBusinessSettings(access.businessId);
      const site = settings.sites.find((candidate) => candidate.id === data.siteId);
      if (!site) return { checked: false, found: false, url: "", status: null, message: "That website is not on this business." };

      const origin = site.allowedOrigins[0];
      if (!origin) {
        return {
          checked: false,
          found: false,
          url: "",
          status: null,
          message: "Add your website address below first, then check again.",
        };
      }

      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return { checked: false, found: false, url: origin, status: null, message: "That website address is not a URL." };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { checked: false, found: false, url: origin, status: null, message: "Only http and https websites can be checked." };
      }
      if (isPrivateHost(url.hostname)) {
        return { checked: false, found: false, url: origin, status: null, message: "That address is on a private network, so it cannot be checked from here." };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          redirect: "follow",
          headers: { "user-agent": "Webina install check (+https://webina.io)" },
        });
        const body = (await response.text()).slice(0, 2_000_000);
        const found = body.includes(site.siteKey) || body.includes("webina-widget.js");
        const result: InstallCheckResult = {
          checked: true,
          found,
          url: url.toString(),
          status: response.status,
          message: found
            ? "Found the Webina snippet on your page."
            : "That page loaded, but the Webina snippet was not in the HTML.",
        };
        await recordInstallCheck(access.businessId, access.userId, {
          found,
          url: url.toString(),
          at: new Date(),
        });
        return result;
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return {
          checked: true,
          found: false,
          url: url.toString(),
          status: null,
          message: aborted
            ? "Your site took too long to answer. Try again, or check it yourself in a browser."
            : "That address could not be reached from here. Check the address, then try again.",
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

/* ------------------------------------------------------------------ *
 * Test chat sandbox
 * ------------------------------------------------------------------ */

export interface TestChatReply {
  conversationId: string;
  reply: string;
  status: string;
  tools: string[];
}

/**
 * The sandbox: the real agent loop, the real tools, the tenant's real prices —
 * just no customer. The conversation is an ordinary web conversation, so it
 * appears in the list and can be handed over like any other.
 */
export const sendTestChat = createServerFn({ method: "POST" })
  .validator((input: unknown) => testChatInput.parse(input))
  .handler(async ({ data }): Promise<Result<TestChatReply>> =>
    run(data.businessId, async (access) => {
      const { createConversation, getConversation, recordAudit } = await import("@webina/db");
      const { resolveModelClient, runAgent } = await import("@webina/agent");

      const conversationId =
        data.conversationId ??
        (await createConversation(access.businessId, { channel: "web" })).id;
      // A conversation id from another tenant must read as "not found", which
      // is exactly what this throws.
      await getConversation(access.businessId, conversationId);

      const model = resolveModelClient(process.env);
      const result = await runAgent(
        { businessId: access.businessId, conversationId, channel: "web", userText: data.message },
        { model: model.client, config: { model: model.model } },
      );

      await recordAudit(access.businessId, access.userId, "test_chat_sent", {
        conversationId,
        status: result.status,
      });

      return {
        conversationId,
        reply: result.reply,
        status: result.status,
        tools: result.toolsCalled.map((call) => call.name),
      };
    }),
  );
