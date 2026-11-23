import { expect, mock, test } from "bun:test";

test("database prompt offers SQLite by default and PostgreSQL", async () => {
  let captured: Record<string, unknown> = {};
  await mock.module("@inquirer/prompts", () => ({
    select: async (config: Record<string, unknown>) => {
      captured = config;
      return "postgres";
    },
    input: async () => "",
    confirm: async () => false,
  }));

  const { askDatabase } = await import("../src/prompts.ts");
  await askDatabase();

  expect(captured["message"]).toBe("Database:");
  expect(captured["default"]).toBe("sqlite");
  const choices = captured["choices"] as Array<{ name: string; value: string }>;
  expect(choices.map((choice) => choice.value)).toEqual(["sqlite", "postgres"]);
  expect(choices[0]?.name).toContain("SQLite");
  expect(choices[0]?.name).toContain("default");
  expect(choices[1]?.name).toContain("PostgreSQL");
  mock.restore();
});
