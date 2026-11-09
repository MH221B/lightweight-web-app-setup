import { Controller, Inject } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { Effect } from "effect";
import { notesContract } from "@shared/notes.contract";
import { NotesService } from "@server/notes/notes.service";

@Controller()
export class NotesController {
  constructor(@Inject(NotesService) private readonly notesService: NotesService) {}

  @Implement(notesContract.list)
  list() {
    return implement(notesContract.list).handler(async () => {
      const notes = await Effect.runPromise(
        Effect.match(this.notesService.list(), {
          onFailure: () => null,
          onSuccess: (value) => value,
        }),
      );
      if (notes === null)
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Notes are unavailable" });
      return { notes };
    });
  }

  @Implement(notesContract.create)
  create() {
    return implement(notesContract.create).handler(async ({ input }) => {
      const note = await Effect.runPromise(
        Effect.match(this.notesService.create(input.text), {
          onFailure: () => null,
          onSuccess: (value) => value,
        }),
      );
      if (note === null)
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Notes are unavailable" });
      return { note };
    });
  }
}
