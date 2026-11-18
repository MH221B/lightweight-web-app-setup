import { oc } from "@orpc/contract";
import { z } from "zod";

export const NOTE_MAX_LENGTH = 200;
const note = z.object({ id: z.number(), text: z.string(), createdAt: z.string() });

export const notesContract = {
  list: oc.route({ method: "GET", path: "/api/notes" }).output(z.object({ notes: z.array(note) })),
  create: oc
    .route({ method: "POST", path: "/api/notes", successStatus: 201 })
    .input(z.object({ text: z.string().trim().min(1).max(NOTE_MAX_LENGTH) }))
    .output(z.object({ note })),
};
