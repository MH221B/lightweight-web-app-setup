import { ORPCError } from "@orpc/nest";
import { Effect } from "effect";
import type { NotesStorageError } from "@server/notes/notes.service";

export async function runNotesEffect<T>(effect: Effect.Effect<T, NotesStorageError>): Promise<T> {
  return Effect.runPromise(
    Effect.match(effect, {
      onFailure: () => {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Notes are unavailable" });
      },
      onSuccess: (value) => value,
    }),
  );
}
