import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Controller } from "awilixify";
import { Effect } from "effect";
import type { NotesService } from "@server/notes/notes.service";

export const CreateNoteSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export class NotesController implements Controller {
  constructor(private readonly notesService: NotesService) {}

  registerRoutes() {
    return new Hono()
      .get("/", async (c) => {
        const outcome = await Effect.runPromise(
          Effect.match(this.notesService.list(), {
            onFailure: () => ({ ok: false as const }),
            onSuccess: (notes) => ({ ok: true as const, notes }),
          }),
        );

        if (!outcome.ok) {
          return c.json({ error: "Notes are unavailable" }, 503);
        }

        return c.json({ notes: outcome.notes }, 200);
      })
      .post(
        "/",
        zValidator("json", CreateNoteSchema, (result, c) => {
          if (!result.success) {
            return c.json({ error: "Note text must be 1-200 characters" }, 400);
          }
        }),
        async (c) => {
          const { text } = c.req.valid("json");

          const outcome = await Effect.runPromise(
            Effect.match(this.notesService.create(text), {
              onFailure: () => ({ ok: false as const }),
              onSuccess: (note) => ({ ok: true as const, note }),
            }),
          );

          if (!outcome.ok) {
            return c.json({ error: "Notes are unavailable" }, 503);
          }

          return c.json({ note: outcome.note }, 201);
        },
      );
  }
}
