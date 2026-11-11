#!/usr/bin/env tsx
/**
 * `pnpm eval` — run the scenario set against the real model.
 *
 *   pnpm eval                          # every scenario, every trade
 *   pnpm eval --template lawnmowing    # one trade
 *   pnpm eval --scenario lawnmowing-common-01
 *   pnpm eval --out report.json        # also write the full report
 *
 * Needs `ANTHROPIC_API_KEY` and `AGENT_MODEL`. Without them it says so and
 * exits 2 — it never falls back to a fake, because a scenario report that did
 * not touch the model would be a lie.
 *
 * Defaults to the local development database (127.0.0.1:5433, the one the
 * tests build). Point DATABASE_URL at a Neon branch to evaluate against that.
 */

import { writeFile } from "node:fs/promises";

import { AnthropicModelClient } from "../src/model";
import { resolveAgentConfig } from "../src/config";
import {
  buildScenarios,
  EVAL_TEMPLATES,
  type EvalTemplate,
  type Scenario,
} from "../src/eval/scenarios";
import { dbEnvironment, runScenarioSet, summarise } from "../src/eval/runner";

const LOCAL_APP = "postgresql://webina_app:webina_app_test@127.0.0.1:5433/webina_test";

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function shorten(text: string, limit = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

async function main(): Promise<number> {
  process.env.DATABASE_URL ??= LOCAL_APP;

  const argv = process.argv.slice(2);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set — the scenario report needs the real model.");
    return 2;
  }

  let config;
  try {
    config = resolveAgentConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid agent configuration");
    console.error("Set AGENT_MODEL (for example AGENT_MODEL=claude-sonnet-4-5) and try again.");
    return 2;
  }

  const templateFlag = flag(argv, "template");
  if (templateFlag && !EVAL_TEMPLATES.includes(templateFlag as EvalTemplate)) {
    console.error(`unknown template "${templateFlag}" — one of ${EVAL_TEMPLATES.join(", ")}`);
    return 2;
  }
  const scenarioFlag = flag(argv, "scenario");

  let scenarios: Scenario[] = buildScenarios();
  if (templateFlag) scenarios = scenarios.filter((entry) => entry.template === templateFlag);
  if (scenarioFlag) scenarios = scenarios.filter((entry) => entry.id === scenarioFlag);
  if (scenarios.length === 0) {
    console.error("no scenarios matched");
    return 2;
  }

  const model = new AnthropicModelClient();
  console.log(
    `Running ${scenarios.length} scenarios against ${config.model} (max ${config.maxSteps} steps each)…`,
  );

  const outcomes = await runScenarioSet({
    scenarios,
    model,
    environment: dbEnvironment(),
    config,
    onOutcome(outcome) {
      const verdict = outcome.failures.length === 0 ? "PASS" : "FAIL";
      console.log(
        [
          `${verdict} ${outcome.scenario.id}`,
          `  tools: ${outcome.toolsCalled.join(", ") || "none"}`,
          `  bookings: ${outcome.bookingsCreated}`,
          `  handoff: ${outcome.handedOff ? "yes" : "no"}`,
          `  tokens: ${outcome.tokensIn} in / ${outcome.tokensOut} out`,
          `  reply: ${shorten(outcome.reply)}`,
          ...outcome.failures.map((failure) => `  ✗ ${failure}`),
        ].join("\n"),
      );
    },
  });

  const summary = summarise(outcomes);
  console.log(
    [
      "",
      `Scenarios: ${summary.total} · passed ${summary.passed} · failed ${summary.failed}`,
      `Bookings created: ${summary.bookingsCreated} · handoffs: ${summary.handoffs}`,
      `Tokens: ${summary.tokensIn} in / ${summary.tokensOut} out`,
    ].join("\n"),
  );

  const out = flag(argv, "out");
  if (out) {
    await writeFile(
      out,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          model: config.model,
          summary,
          outcomes: outcomes.map((outcome) => ({
            id: outcome.scenario.id,
            template: outcome.scenario.template,
            tag: outcome.scenario.tag,
            message: outcome.scenario.message,
            reply: outcome.reply,
            status: outcome.status,
            toolsCalled: outcome.toolsCalled,
            bookingsCreated: outcome.bookingsCreated,
            handedOff: outcome.handedOff,
            tokensIn: outcome.tokensIn,
            tokensOut: outcome.tokensOut,
            failures: outcome.failures,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`Report written to ${out}`);
  }

  return summary.failed === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
