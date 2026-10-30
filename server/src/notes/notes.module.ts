import { createModule, type ModuleDef } from "awilixify";
import type { AppDatabase } from "../db";
import { NotesController } from "./notes.controller";
import { NotesService } from "./notes.service";

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
