import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

export interface EnvValues {
  NODE_ENV: string;
  PORT: number;
  DATABASE_PATH?: string;
  CLIENT_DIST: string;
}

export type ParseEnv = (source?: Record<string, string | undefined>) => EnvValues;

export function describeEnvCases(name: string, parseEnv: ParseEnv): void {
  describe(`environment validation (${name})`, () => {
    test("uses defaults and parses configured values", () => {
      expect(parseEnv({})).toEqual({
        NODE_ENV: "development",
        PORT: 3000,
        CLIENT_DIST: resolve(repoRoot, "client/dist"),
      });
      expect(
        parseEnv({
          NODE_ENV: "production",
          PORT: "65535",
          DATABASE_PATH: "notes.db",
          CLIENT_DIST: "client-angular/dist",
        }),
      ).toEqual({
        NODE_ENV: "production",
        PORT: 65535,
        DATABASE_PATH: "notes.db",
        CLIENT_DIST: resolve(repoRoot, "client-angular/dist"),
      });
    });

    test("preserves an absolute CLIENT_DIST", () => {
      const absolute = resolve(repoRoot, "custom/dist");
      expect(parseEnv({ CLIENT_DIST: absolute }).CLIENT_DIST).toBe(absolute);
    });

    test("rejects invalid values", () => {
      for (const source of [
        { NODE_ENV: "invalid" },
        { PORT: "0" },
        { PORT: "65536" },
        { PORT: "3.5" },
        { PORT: "not-a-number" },
        { DATABASE_PATH: "" },
        { CLIENT_DIST: "" },
      ]) {
        expect(() => parseEnv(source)).toThrow();
      }
    });
  });
}
