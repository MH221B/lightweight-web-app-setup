import { Module } from "@nestjs/common";
import { ImplementInterceptor, ORPC_MODULE_CONFIG_SYMBOL } from "@orpc/nest";
import { NotesController } from "@server/notes/notes.controller";
import { NOTES_ORPC_CONFIG } from "@server/notes/notes.errors";
import { NotesService } from "@server/notes/notes.service";

@Module({
  providers: [
    NotesService,
    ImplementInterceptor,
    {
      provide: ORPC_MODULE_CONFIG_SYMBOL,
      useValue: NOTES_ORPC_CONFIG,
    },
  ],
  controllers: [NotesController],
})
export class NotesModule {}
