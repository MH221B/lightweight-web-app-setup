import { resolve } from "node:path";
import { z } from "zod";

const repoRoot = resolve(import.meta.dir, "../..");
const defaultClientDist = resolve(repoRoot, "client/dist");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).optional(),
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

export const env = parseEnv();
