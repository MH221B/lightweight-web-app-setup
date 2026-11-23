import { oc } from "@orpc/contract";
import { z } from "zod";
import { NOTE_MAX_LENGTH, NOTES_CREATE_STATUS, NOTES_PATH } from "./notes.meta";

export { NOTE_MAX_LENGTH };
const note = z.object({ id: z.number(), text: z.string(), createdAt: z.string() });

export const notesContract = {
  list: oc.route({ method: "GET", path: NOTES_PATH }).output(z.object({ notes: z.array(note) })),
  create: oc
    .route({ method: "POST", path: NOTES_PATH, successStatus: NOTES_CREATE_STATUS })
    .input(z.object({ text: z.string().trim().min(1).max(NOTE_MAX_LENGTH) }))
    .output(z.object({ note })),
};
