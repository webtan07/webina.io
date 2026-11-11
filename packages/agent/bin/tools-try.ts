#!/usr/bin/env tsx
/**
 * `pnpm tools:try` — run one tool against a real tenant and see the result.
 *
 *   pnpm tools:try list_services --business <id|slug>
 *   pnpm tools:try get_quote --business <id> --json '{"serviceId":"…","options":{"lawnSize":"medium"}}'
 *   pnpm tools:try check_availability --business <id> --service <id> --date 2026-10-06
 *   pnpm tools:try create_booking --business <id> --json '{"serviceId":"…","startIso":"…","customerName":"…","customerPhone":"0400 000 000","address":"…","idempotencyKey":"try-0001"}'
 *
 * Defaults to the local development database (127.0.0.1:5433, the same one the
 * tests build). Point DATABASE_URL at another database to try a different one;
 * MIGRATE_DATABASE_URL is only used to turn a slug into an id.
 */

import { Client } from "pg";

import { runTool, TOOLS } from "../src/tools";

const LOCAL_APP = "postgresql://webina_app:webina_app_test@127.0.0.1:5433/webina_test";
const LOCAL_MIGRATOR = "postgresql://webina_migrator:webina_migrator_test@127.0.0.1:5433/webina_test";

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveBusinessId(value: string): Promise<string> {
  if (UUID_RE.test(value)) return value;
  const url = process.env.MIGRATE_DATABASE_URL ?? LOCAL_MIGRATOR;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM businesses WHERE slug = $1 OR id::text = $1 LIMIT 1",
      [value],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`no business matches "${value}" (pass an id or a slug)`);
    return id;
  } finally {
    await client.end();
  }
}

function usage(): void {
  console.log(
    [
      "Usage: pnpm tools:try <tool> --business <id|slug> [--json '<input>'] [--conversation <id>] [--channel web]",
      "",
      "Convenience flags (merged over --json):",
      "  --service <id>   --date YYYY-MM-DD   --start <iso>",
      "  --name <name>    --phone <phone>     --address <address>",
      "",
      `Tools: ${Object.keys(TOOLS).join(", ")}`,
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  process.env.DATABASE_URL ??= LOCAL_APP;
  process.env.MIGRATE_DATABASE_URL ??= LOCAL_MIGRATOR;

  const argv = process.argv.slice(2);
  const toolName = argv.find((arg) => !arg.startsWith("--") && TOOLS[arg as keyof typeof TOOLS]);
  if (!toolName) {
    usage();
    return 1;
  }

  const businessArg = flag(argv, "business");
  if (!businessArg) {
    usage();
    return 1;
  }
  const businessId = await resolveBusinessId(businessArg);

  const rawJson = flag(argv, "json");
  let input: Record<string, unknown> = {};
  if (rawJson) {
    try {
      input = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      console.error("--json is not valid JSON");
      return 1;
    }
  }
  const convenience: [string, string | undefined][] = [
    ["serviceId", flag(argv, "service")],
    ["date", flag(argv, "date")],
    ["startIso", flag(argv, "start")],
    ["customerName", flag(argv, "name")],
    ["customerPhone", flag(argv, "phone")],
    ["address", flag(argv, "address")],
  ];
  for (const [key, value] of convenience) {
    if (value !== undefined) input[key] = value;
  }

  const channel = flag(argv, "channel");
  const result = await runTool(toolName, input, {
    businessId,
    conversationId: flag(argv, "conversation") ?? null,
    channel: channel === "sms" || channel === "whatsapp" ? channel : "web",
  });

  console.log(JSON.stringify({ tool: toolName, businessId, input, result }, null, 2));
  return result.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
