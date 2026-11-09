import { Module } from "@nestjs/common";
import { NotesController } from "@server/notes/notes.controller";
import { NotesService } from "@server/notes/notes.service";

@Module({ controllers: [NotesController], providers: [NotesService] })
export class NotesModule {}
