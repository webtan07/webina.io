/**
 * The scenario runner.
 *
 * Not part of CI and not part of the test suite: it spends real tokens against
 * the real model, so it runs when someone asks for it (`pnpm eval`) and needs
 * `ANTHROPIC_API_KEY` and `AGENT_MODEL` to be set.
 *
 * Each scenario gets its own throwaway tenant, seeded from the trade fixture,
 * and its own conversation — so a scenario can never inherit another one's
 * history, bookings or handoff state. That is what makes the per-scenario
 * result meaningful: one message in, one transcript out.
 */

import {
  createBusiness,
  createService,
  getConversation,
  getDb,
  listBookings,
  replaceAvailabilityRules,
  setPlanKey,
  setServiceArea,
  updateAssistantSettings,
  user,
  withTenant,
} from "@webina/db";
import { conversations } from "@webina/db/schema";
import type { ServiceInput } from "@webina/shared";

import type { AgentConfig } from "../config";
import { runAgent, type RunStatus } from "../loop";
import type { ModelClient } from "../model";
import {
  checkExpectations,
  fixtureFor,
  type EvalFixture,
  type Scenario,
} from "./scenarios";

export interface ScenarioEnvironment {
  businessId: string;
  conversationId: string;
}

export type EnvironmentFactory = (fixture: EvalFixture) => Promise<ScenarioEnvironment>;

const WEEKDAY_RULES = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "08:00",
  endTime: "16:00",
  slotMinutes: 60,
  capacity: 1,
}));

/** A real tenant in the database, seeded from a fixture. */
export function dbEnvironment(): EnvironmentFactory {
  return async (fixture) => {
    const email = `eval-${fixture.template}-${Math.random().toString(36).slice(2, 10)}@example.test`;
    const userId = crypto.randomUUID();
    await getDb().insert(user).values({ id: userId, name: fixture.businessName, email, emailVerified: true });

    const created = await createBusiness(
      {
        name: fixture.businessName,
        timezone: "Australia/Adelaide",
        tradeTemplate: fixture.template,
        ownerNotifyEmail: email,
        assistantName: "Webina",
      },
      { userId, environment: "test" },
    );

    for (const service of fixture.services) {
      await createService(created.businessId, {
        name: service.name,
        pricingType: service.pricingType,
        priceCents: service.priceCents,
        pricingConfig: (service.pricingConfig ?? { tiers: [], extras: [] }) as ServiceInput["pricingConfig"],
        durationMinutes: service.durationMinutes ?? null,
        schedulingType: service.schedulingType,
        intakeFields: (service.intakeFields ?? []) as ServiceInput["intakeFields"],
      });
    }

    await setServiceArea(created.businessId, {
      type: "suburb_list",
      values: fixture.suburbs,
    });
    await replaceAvailabilityRules(created.businessId, WEEKDAY_RULES);
    await setPlanKey(created.businessId, "front_desk");

    // The trade's own notes and tone, so the prompt is the one a real tenant
    // of this template would get.
    await updateAssistantSettings(created.businessId, {
      tone: fixture.tone,
      businessRules: fixture.businessRules,
    });

    const conversationId = crypto.randomUUID();
    await withTenant(created.businessId, async (tx) => {
      await tx.insert(conversations).values({
        id: conversationId,
        businessId: created.businessId,
        channel: "web",
        customerRef: `eval-${conversationId.slice(0, 8)}`,
        status: "active",
      });
    });

    return { businessId: created.businessId, conversationId };
  };
}

export interface ScenarioOutcome {
  scenario: Scenario;
  reply: string;
  status: RunStatus;
  toolsCalled: string[];
  bookingsCreated: number;
  handedOff: boolean;
  tokensIn: number;
  tokensOut: number;
  steps: number;
  failures: string[];
}

export interface RunScenarioSetOptions {
  scenarios: readonly Scenario[];
  model: ModelClient;
  environment: EnvironmentFactory;
  config?: Partial<AgentConfig>;
  onOutcome?: (outcome: ScenarioOutcome) => void;
}

export async function runScenarioSet(options: RunScenarioSetOptions): Promise<ScenarioOutcome[]> {
  const outcomes: ScenarioOutcome[] = [];

  for (const scenario of options.scenarios) {
    const fixture = fixtureFor(scenario.template);
    const environment = await options.environment(fixture);

    const result = await runAgent(
      {
        businessId: environment.businessId,
        conversationId: environment.conversationId,
        channel: "web",
        userText: scenario.message,
      },
      { model: options.model, config: options.config },
    );

    const [bookings, conversation] = await Promise.all([
      listBookings(environment.businessId, 10),
      getConversation(environment.businessId, environment.conversationId),
    ]);

    const outcome: ScenarioOutcome = {
      scenario,
      reply: result.reply,
      status: result.status,
      toolsCalled: result.toolsCalled.map((call) => call.name),
      bookingsCreated: bookings.length,
      handedOff: conversation.status === "handed_off",
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      steps: result.steps,
      failures: [],
    };
    outcome.failures = checkExpectations(scenario, {
      toolsCalled: outcome.toolsCalled,
      reply: outcome.reply,
      bookingsCreated: outcome.bookingsCreated,
      handedOff: outcome.handedOff,
    });

    outcomes.push(outcome);
    options.onOutcome?.(outcome);
  }

  return outcomes;
}

export interface ScenarioSummary {
  total: number;
  passed: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  bookingsCreated: number;
  handoffs: number;
}

export function summarise(outcomes: readonly ScenarioOutcome[]): ScenarioSummary {
  return {
    total: outcomes.length,
    passed: outcomes.filter((outcome) => outcome.failures.length === 0).length,
    failed: outcomes.filter((outcome) => outcome.failures.length > 0).length,
    tokensIn: outcomes.reduce((total, outcome) => total + outcome.tokensIn, 0),
    tokensOut: outcomes.reduce((total, outcome) => total + outcome.tokensOut, 0),
    bookingsCreated: outcomes.reduce((total, outcome) => total + outcome.bookingsCreated, 0),
    handoffs: outcomes.filter((outcome) => outcome.handedOff).length,
  };
}
