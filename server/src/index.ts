import { createApp } from "@server/app";
import { createDb, defaultDatabasePath, migrateDb } from "@server/db";
import { parseEnv } from "@server/env";

export async function start(env = parseEnv()) {
  const db = createDb(env.DATABASE_PATH ?? defaultDatabasePath);
  migrateDb(db);
  const app = await createApp(db, { serveClient: true, clientDist: env.CLIENT_DIST });
  await app.listen(env.PORT, "0.0.0.0");
  console.log(
    `Serving API and client on http://localhost:${env.PORT} (database: ${env.DATABASE_PATH ?? defaultDatabasePath})`,
  );
  return app;
}

if (import.meta.main) {
  await start();
}
