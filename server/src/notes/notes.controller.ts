import { Controller, Inject } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import { Effect } from "effect";
import { notesContract } from "@shared/notes.contract";
import { NotesService } from "@server/notes/notes.service";

@Controller()
export class NotesController {
  constructor(@Inject(NotesService) private readonly notesService: NotesService) {}

  @TsRestHandler(notesContract.list)
  list() {
    return tsRestHandler(notesContract.list, async () => {
      const result = await Effect.runPromise(
        Effect.match(this.notesService.list(), {
          onFailure: () => ({ status: 503 as const, body: { error: "Notes are unavailable" } }),
          onSuccess: (notes) => ({ status: 200 as const, body: { notes } }),
        }),
      );
      return result;
    });
  }

  @TsRestHandler(notesContract.create)
  create() {
    return tsRestHandler(notesContract.create, async ({ body }) => {
      return Effect.runPromise(
        Effect.match(this.notesService.create(body.text), {
          onFailure: () => ({ status: 503 as const, body: { error: "Notes are unavailable" } }),
          onSuccess: (note) => ({ status: 201 as const, body: { note } }),
        }),
      );
    });
  }
}
