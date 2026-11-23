import { resolve } from "node:path";
import { Effect, Schema } from "effect";

const repoRoot = resolve(import.meta.dir, "../../../..");
const defaultClientDist = resolve(repoRoot, "client/dist");

// Same structural check as the Zod twin: scheme, a real hostname, no whitespace.
function isDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
    return url.hostname.length > 0 && !/\s/.test(url.hostname);
  } catch {
    return false;
  }
}

const EnvSchema = Schema.Struct({
  NODE_ENV: Schema.Literals(["development", "test", "production"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("development" as const)),
  ),
  PORT: Schema.FiniteFromString.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 65535 }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed("3000"))),
  DATABASE_URL: Schema.String.check(
    Schema.makeFilter(
      (value: string) =>
        isDatabaseUrl(value) ||
        "DATABASE_URL must be a postgres:// or postgresql:// URL with a host",
    ),
  ),
  CLIENT_DIST: Schema.String.check(Schema.isMinLength(1)).pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultClientDist)),
  ),
});

export type Env = typeof EnvSchema.Type;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const raw = Schema.decodeUnknownSync(EnvSchema)(source);
  return { ...raw, CLIENT_DIST: resolve(repoRoot, raw.CLIENT_DIST) };
}
