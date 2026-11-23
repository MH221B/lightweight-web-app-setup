import { resolve } from "node:path";
import { z } from "zod";

const repoRoot = resolve(import.meta.dir, "../../../..");
const defaultClientDist = resolve(repoRoot, "client/dist");

// Scheme alone is not enough: `postgres://` parses as a URL with an empty
// host and `postgres://not a valid host` has a whitespace hostname. Parse
// the URL and require a real, whitespace-free hostname.
function isDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
    return url.hostname.length > 0 && !/\s/.test(url.hostname);
  } catch {
    return false;
  }
}

const databaseUrl = z
  .string()
  .refine(isDatabaseUrl, "DATABASE_URL must be a postgres:// or postgresql:// URL with a host");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: databaseUrl,
  CLIENT_DIST: z
    .string()
    .min(1)
    .default(defaultClientDist)
    .transform((dir) => resolve(repoRoot, dir)),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source);
}
