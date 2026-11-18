import { Data, Effect } from "effect";
import { Inject, Injectable } from "@nestjs/common";
import { desc } from "drizzle-orm";
import type { AppDatabase } from "@server/schema";
import { notes, type Note } from "@server/notes/schema";

export class NotesStorageError extends Data.TaggedError("NotesStorageError")<{
  readonly cause: unknown;
}> {}

@Injectable()
export class NotesService {
  constructor(@Inject("DATABASE") private readonly db: AppDatabase) {}

  list(): Effect.Effect<Note[], NotesStorageError> {
    return Effect.try({
      try: () => this.db.select().from(notes).orderBy(desc(notes.id)).all(),
      catch: (cause) => new NotesStorageError({ cause }),
    });
  }

  create(text: string): Effect.Effect<Note, NotesStorageError> {
    return Effect.try({
      try: () => {
        const row = this.db
          .insert(notes)
          .values({ text, createdAt: new Date().toISOString() })
          .returning()
          .get();

        if (row === undefined) {
          throw new Error("Insert returned no row");
        }

        return row;
      },
      catch: (cause) => new NotesStorageError({ cause }),
    });
  }
}
