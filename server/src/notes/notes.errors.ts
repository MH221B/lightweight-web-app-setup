import { ORPCError } from "@orpc/nest";
import { Effect } from "effect";
import type { NotesStorageError } from "@server/notes/notes.service";

export const NOTES_STORAGE_ERROR = "NOTES_STORAGE_UNAVAILABLE";
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
