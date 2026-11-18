import { describe, expect, test } from "bun:test";
import { parseEnv } from "@server/env";

describe("environment validation", () => {
  test("uses defaults and parses configured values", () => {
    expect(parseEnv({})).toEqual({ NODE_ENV: "development", PORT: 3000 });
    expect(parseEnv({ NODE_ENV: "production", PORT: "65535", DATABASE_PATH: "notes.db" })).toEqual({
      NODE_ENV: "production",
      PORT: 65535,
      DATABASE_PATH: "notes.db",
    });
  });

  test("rejects invalid values", () => {
    for (const source of [
      { NODE_ENV: "invalid" },
      { PORT: "0" },
      { PORT: "65536" },
      { PORT: "3.5" },
      { PORT: "not-a-number" },
      { DATABASE_PATH: "" },
    ]) {
      expect(() => parseEnv(source)).toThrow();
    }
  });
});
