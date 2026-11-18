import { Controller, Inject } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { notesContract } from "@shared/notes.contract";
import { runNotesEffect } from "@server/notes/notes.errors";
import { NotesService } from "@server/notes/notes.service";

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
