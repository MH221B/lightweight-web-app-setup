import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const url = "postgres://user:pass@localhost:5432/notes";

export interface EnvValues {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  CLIENT_DIST: string;
}

export type ParseEnv = (source?: Record<string, string | undefined>) => EnvValues;

export function describeEnvCases(name: string, parseEnv: ParseEnv): void {
  describe(`postgres environment validation (${name})`, () => {
    test("requires DATABASE_URL and parses configured values", () => {
      expect(() => parseEnv({})).toThrow();
      expect(parseEnv({ DATABASE_URL: url })).toEqual({
        NODE_ENV: "development",
        PORT: 3000,
        DATABASE_URL: url,
        CLIENT_DIST: resolve(repoRoot, "client/dist"),
      });
      expect(
        parseEnv({
          NODE_ENV: "production",
          PORT: "65535",
          DATABASE_URL: "postgresql://db.local:5432/notes",
          CLIENT_DIST: "custom/dist",
        }),
      ).toEqual({
        NODE_ENV: "production",
        PORT: 65535,
        DATABASE_URL: "postgresql://db.local:5432/notes",
        CLIENT_DIST: resolve(repoRoot, "custom/dist"),
      });
    });

    test("does not use a sqlite fallback", () => {
      // No sqlite fallback: DATABASE_PATH is ignored and never satisfies the contract.
      expect(() => parseEnv({ DATABASE_PATH: ":memory:" })).toThrow();
      expect(parseEnv({ DATABASE_URL: url })).not.toHaveProperty("DATABASE_PATH");
    });

    test("rejects invalid values", () => {
      for (const source of [
        { DATABASE_URL: url, NODE_ENV: "invalid" },
        { DATABASE_URL: url, PORT: "0" },
        { DATABASE_URL: url, PORT: "65536" },
        { DATABASE_URL: url, PORT: "3.5" },
        { DATABASE_URL: url, PORT: "not-a-number" },
        { DATABASE_URL: url, CLIENT_DIST: "" },
        { DATABASE_URL: "" },
        { DATABASE_URL: "http://localhost/db" },
        { DATABASE_URL: "mysql://localhost/db" },
        { DATABASE_URL: "postgres:/missing-slashes" },
        { DATABASE_URL: "postgres" },
        // Scheme alone is not the contract: no authority, and a host that
        // only looks like one because it contains spaces.
        { DATABASE_URL: "postgres://" },
        { DATABASE_URL: "postgres://not a valid host" },
        { DATABASE_URL: "postgres://localhost" },
        { DATABASE_URL: "postgres://user@localhost/" },
      ]) {
        expect(() => parseEnv(source)).toThrow();
      }
      expect(parseEnv({ DATABASE_URL: "postgresql://localhost/db" }).DATABASE_URL).toBe(
        "postgresql://localhost/db",
      );
    });
  });
}
