import { createApp } from "@server/app";
import { createDb, defaultDatabasePath, migrateDb } from "@server/db";

const db = createDb();
migrateDb(db);

const app = createApp(db, { serveClient: true });
const port = Number(process.env.PORT ?? 3000);

console.log(
  `Serving API and client on http://localhost:${port} (database: ${
    process.env.DATABASE_PATH ?? defaultDatabasePath
  })`,
);

export default {
  port,
  fetch: app.fetch,
};
