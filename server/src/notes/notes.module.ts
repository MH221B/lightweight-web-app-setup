import { Module } from "@nestjs/common";
import { ImplementInterceptor, ORPC_MODULE_CONFIG_SYMBOL, type ORPCModuleConfig } from "@orpc/nest";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";
import { NotesController } from "@server/notes/notes.controller";
import { NOTES_STORAGE_ERROR } from "@server/notes/notes.errors";
import { NotesService } from "@server/notes/notes.service";

@Module({
  providers: [
    NotesService,
    ImplementInterceptor,
    {
      provide: ORPC_MODULE_CONFIG_SYMBOL,
      useValue: {
        customErrorResponseBodyEncoder(error) {
          if (error.status === 400)
            return { error: `Note text must be 1-${NOTE_MAX_LENGTH} characters` };
          if (error.code === NOTES_STORAGE_ERROR) return { error: error.message };
          return { error: error.status >= 500 ? "Internal server error" : error.message };
        },
      } satisfies ORPCModuleConfig,
    },
  ],
  controllers: [NotesController],
})
export class NotesModule {}
