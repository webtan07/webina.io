#!/usr/bin/env tsx
/** pnpm db:migrate — apply pending migrations with the MIGRATOR role. */

import { migrate } from "./migrate";

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error("MIGRATE_DATABASE_URL is not set (migrator role; never the runtime role)");
  process.exit(1);
}

const applied = await migrate({ connectionString: url, log: (m) => console.log(m) });
console.log(applied.length === 0 ? "no pending migrations" : `applied ${applied.length} migration(s)`);
