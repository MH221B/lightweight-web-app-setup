import { expect, mock, test } from "bun:test";

test("prompts offer their documented defaults and choices", async () => {
  const captured: Record<string, Record<string, unknown>> = {};
  await mock.module("@inquirer/prompts", () => ({
    select: async (config: Record<string, unknown>) => {
      captured[String(config["message"])] = config;
      const choices = config["choices"] as Array<{ value: string }> | undefined;
      return choices?.[0]?.value ?? "";
    },
    input: async () => "",
    confirm: async () => false,
  }));

  const { askDatabase, askStyling } = await import("../src/prompts.ts");
  await askDatabase();
  await askStyling();

  const database = captured["Database:"] ?? {};
  expect(database["default"]).toBe("sqlite");
  const databaseChoices = database["choices"] as Array<{ name: string; value: string }>;
  expect(databaseChoices.map((choice) => choice.value)).toEqual(["sqlite", "postgres"]);
  expect(databaseChoices[0]?.name).toContain("SQLite");
  expect(databaseChoices[0]?.name).toContain("default");
  expect(databaseChoices[1]?.name).toContain("PostgreSQL");

  const styling = captured["Styling:"] ?? {};
  expect(styling["default"]).toBe("scss");
  const stylingChoices = styling["choices"] as Array<{ name: string; value: string }>;
  expect(stylingChoices.map((choice) => choice.value)).toEqual(["scss", "tailwind", "both"]);
  expect(stylingChoices[0]?.name).toContain("SCSS");
  expect(stylingChoices[0]?.name).toContain("default");
  expect(stylingChoices[1]?.name).toContain("Tailwind");
  expect(stylingChoices[2]?.name).toContain("Tailwind");
  mock.restore();
});
