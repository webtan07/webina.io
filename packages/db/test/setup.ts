/** Runs in every worker before the tests: point the app at the test database. */

import { APP_TEST_URL, MIGRATOR_TEST_URL } from "./db-urls";

process.env.DATABASE_URL = APP_TEST_URL;
process.env.MIGRATE_DATABASE_URL = MIGRATOR_TEST_URL;
process.env.BETTER_AUTH_SECRET ??= "test-secret-not-used-outside-tests-0000000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
