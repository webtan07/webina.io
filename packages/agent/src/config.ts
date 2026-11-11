/**
 * The agent's controls, read from the environment.
 *
 * Nothing here is a constant the model can influence, and nothing here is
 * baked in at build time: the kill switch and the caps are read on every run,
 * so flipping `AGENT_ENABLED=false` in the hosting environment stops the
 * assistant on the next message without a deploy.
 *
 * `AGENT_MODEL` has no default. The model name belongs to the operator, not to
 * this code, so a missing value is a configuration error the loop turns into a
 * safe fallback rather than a silent guess.
 */

export interface AgentConfig {
  /** Global kill switch. Off means no model call, for every tenant. */
  enabled: boolean;
  /** `AGENT_MODEL` — required. */
  model: string;
  /** Model turns per customer message before the loop gives up. */
  maxSteps: number;
  /** Output tokens per single model call. */
  maxTokens: number;
  /** Turns of transcript sent to the model. */
  historyLimit: number;
  /** Characters of tool output kept per tool_result. */
  maxToolOutputChars: number;
  /** Assistant turns per conversation before the conversation is handed over. */
  maxCallsPerConversation: number;
  /** Total tokens (in + out) one run may spend. */
  maxTokensPerRun: number;
  /** Wait before the single retry. */
  retryBackoffMs: number;
}

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConfigError";
  }
}

const DEFAULTS = {
  enabled: true,
  maxSteps: 6,
  maxTokens: 1_024,
  historyLimit: 30,
  maxToolOutputChars: 4_000,
  maxCallsPerConversation: 12,
  maxTokensPerRun: 40_000,
  retryBackoffMs: 400,
} as const;

function boolFromEnv(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new AgentConfigError(`${name} must be true or false`);
}

function intFromEnv(
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
  env: NodeJS.ProcessEnv,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new AgentConfigError(
      `${name} must be a whole number between ${bounds.min} and ${bounds.max}`,
    );
  }
  return value;
}

/**
 * Environment first, explicit overrides last. `overrides` is how tests and the
 * scenario runner pin a value without mutating `process.env`.
 */
export function resolveAgentConfig(
  overrides: Partial<AgentConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  const fromEnv: AgentConfig = {
    enabled: boolFromEnv("AGENT_ENABLED", DEFAULTS.enabled, env),
    model: (env.AGENT_MODEL ?? "").trim(),
    maxSteps: intFromEnv("MAX_STEPS", DEFAULTS.maxSteps, { min: 1, max: 20 }, env),
    maxTokens: intFromEnv("MAX_TOKENS", DEFAULTS.maxTokens, { min: 64, max: 8_192 }, env),
    historyLimit: intFromEnv("HISTORY_LIMIT", DEFAULTS.historyLimit, { min: 2, max: 200 }, env),
    maxToolOutputChars: intFromEnv(
      "MAX_TOOL_OUTPUT_CHARS",
      DEFAULTS.maxToolOutputChars,
      { min: 200, max: 40_000 },
      env,
    ),
    maxCallsPerConversation: intFromEnv(
      "MAX_CALLS_PER_CONVERSATION",
      DEFAULTS.maxCallsPerConversation,
      { min: 1, max: 100 },
      env,
    ),
    maxTokensPerRun: intFromEnv(
      "MAX_TOKENS_PER_RUN",
      DEFAULTS.maxTokensPerRun,
      { min: 256, max: 400_000 },
      env,
    ),
    retryBackoffMs: intFromEnv(
      "AGENT_RETRY_BACKOFF_MS",
      DEFAULTS.retryBackoffMs,
      { min: 0, max: 10_000 },
      env,
    ),
  };

  const merged: AgentConfig = { ...fromEnv, ...stripUndefined(overrides) };
  if (merged.model === "") {
    throw new AgentConfigError("AGENT_MODEL is not set");
  }
  return merged;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
