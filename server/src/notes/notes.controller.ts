import { Controller, Inject } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { Effect } from "effect";
import { notesContract } from "@shared/notes.contract";
import { NotesService } from "@server/notes/notes.service";

async function runNotesEffect<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
  const result = await Effect.runPromise(
    Effect.match(effect, {
      onFailure: () => null,
      onSuccess: (value) => value,
    }),
  );
  if (result === null)
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Notes are unavailable" });
  return result;
}

@Controller()
export class NotesController {
  constructor(@Inject(NotesService) private readonly notesService: NotesService) {}

  @Implement(notesContract.list)
  list() {
    return implement(notesContract.list).handler(async () => {
      const notes = await runNotesEffect(this.notesService.list());
      return { notes };
    });
  }

  @Implement(notesContract.create)
  create() {
    return implement(notesContract.create).handler(async ({ input }) => {
      const note = await runNotesEffect(this.notesService.create(input.text));
      return { note };
    });
  }
}
