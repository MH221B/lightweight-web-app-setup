import { createModule, type ModuleDef } from "awilixify";
import type { AppDatabase } from "@server/db";
import { NotesController } from "@server/notes/notes.controller";
import { NotesService } from "@server/notes/notes.service";

export type NotesModuleDef = ModuleDef<{
  providers: {
    db: AppDatabase;
    notesService: NotesService;
    notesController: NotesController;
  };
}>;

export function createNotesModule(db: AppDatabase) {
  return createModule<NotesModuleDef>({
    name: "NotesModule",
    providers: {
      db,
      notesService: NotesService,
      notesController: NotesController,
    },
  });
}
