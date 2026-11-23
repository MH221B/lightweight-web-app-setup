import { createApp } from "@server/app";
import { createDb, describeDatabaseUrl, migrateDb } from "@server/variants/postgres/db";
import { parseEnv } from "@server/variants/postgres/env";
import { NotesModule } from "@server/variants/postgres/notes/notes.module";

export async function start(env = parseEnv()) {
  // createDb asserts current_database() before returning: the boot path is
  // guarded before the first migration, exactly like every suite.
  const db = await createDb(env.DATABASE_URL);
  try {
    await migrateDb(db);
    const app = await createApp(db, {
      serveClient: true,
      clientDist: env.CLIENT_DIST,
      notesModule: NotesModule,
    });
    await app.listen(env.PORT, "0.0.0.0");
    console.log(
      `Serving API and client on http://localhost:${env.PORT} (database: ${describeDatabaseUrl(env.DATABASE_URL)})`,
    );
    return { app, db };
  } catch (error) {
    // A failed boot must not leave the pool open: the caller's
    // DROP DATABASE depends on it, and an open pool keeps the test
    // process alive. Close it, then rethrow the original failure.
    await db.$client.end({ timeout: 5 }).catch(() => {});
    throw error;
  }
}

if (import.meta.main) {
  await start();
}
