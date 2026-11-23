import { describe, expect, test } from "bun:test";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";

interface StandardValidation {
  value?: unknown;
  issues?: ReadonlyArray<{ message: string }>;
}

interface StandardSchema {
  "~standard": {
    validate: (value: unknown) => StandardValidation | Promise<StandardValidation>;
  };
}

export function standardCheck(schema: StandardSchema, value: unknown): unknown {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) throw new Error("Expected a synchronous schema");
  if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("; "));
  return result.value;
}

export interface ContractSubject {
  name: string;
  checkInput: (input: unknown) => unknown;
  checkOutput: (value: unknown) => unknown;
}

export function describeContractCases(subject: ContractSubject): void {
  const { name, checkInput, checkOutput } = subject;
  const note = { id: 1, text: "hello", createdAt: "2026-11-23T00:00:00.000Z" };

  describe(`notes contract (${name})`, () => {
    test("trims and decodes valid text", () => {
      expect(checkInput({ text: "  hello  " })).toEqual({ text: "hello" });
    });

    test("rejects empty, whitespace-only, missing, and non-string text", () => {
      for (const input of [{ text: "" }, { text: "   " }, {}, { text: null }, { text: 42 }]) {
        expect(() => checkInput(input)).toThrow();
      }
    });

    test("enforces the shared NOTE_MAX_LENGTH bound", () => {
      expect(checkInput({ text: "x".repeat(NOTE_MAX_LENGTH) })).toEqual({
        text: "x".repeat(NOTE_MAX_LENGTH),
      });
      expect(() => checkInput({ text: "x".repeat(NOTE_MAX_LENGTH + 1) })).toThrow();
    });

    test("decodes the create output", () => {
      expect(checkOutput({ note })).toEqual({ note });
    });
  });
}
