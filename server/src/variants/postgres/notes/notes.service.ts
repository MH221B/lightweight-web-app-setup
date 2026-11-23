import { Inject, Injectable } from "@nestjs/common";
import { desc } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { AppDatabase } from "@server/variants/postgres/schema";
import { notes, type Note } from "@server/variants/postgres/notes/schema";

export class NotesStorageError extends Data.TaggedError("NotesStorageError")<{
  readonly cause: unknown;
}> {}

@Injectable()
export class NotesService {
  constructor(@Inject("DATABASE") private readonly db: AppDatabase) {}

  list(): Effect.Effect<Note[], NotesStorageError> {
    return Effect.tryPromise({
      try: async () => this.db.select().from(notes).orderBy(desc(notes.id)),
      catch: (cause) => new NotesStorageError({ cause }),
    });
  }

  create(text: string): Effect.Effect<Note, NotesStorageError> {
    return Effect.tryPromise({
      try: async () => {
        const [row] = await this.db
          .insert(notes)
          .values({ text, createdAt: new Date().toISOString() })
          .returning();

        if (row === undefined) {
          throw new Error("Insert returned no row");
        }

        return row;
      },
      catch: (cause) => new NotesStorageError({ cause }),
    });
  }
}
