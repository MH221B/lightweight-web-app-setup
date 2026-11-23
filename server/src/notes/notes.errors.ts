import { ORPCError, type ORPCModuleConfig } from "@orpc/nest";
import { Data, Effect } from "effect";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";

export class NotesStorageError extends Data.TaggedError("NotesStorageError")<{
  readonly cause: unknown;
}> {}

export const NOTES_STORAGE_ERROR = "NOTES_STORAGE_UNAVAILABLE";
export const NOTES_ORPC_CONFIG = {
  customErrorResponseBodyEncoder(error) {
    if (error.status === 400) return { error: `Note text must be 1-${NOTE_MAX_LENGTH} characters` };
    if (error.code === NOTES_STORAGE_ERROR) return { error: error.message };
    return { error: error.status >= 500 ? "Internal server error" : error.message };
  },
} satisfies ORPCModuleConfig;
const notesUnavailable = "Notes are unavailable";

export async function runNotesEffect<T>(effect: Effect.Effect<T, NotesStorageError>): Promise<T> {
  return Effect.runPromise(
    Effect.mapError(effect, (error) => {
      console.error("Notes storage failure:", error.cause);
      return new ORPCError(NOTES_STORAGE_ERROR, {
        status: 503,
        message: notesUnavailable,
        cause: error.cause,
      });
    }),
  );
}
