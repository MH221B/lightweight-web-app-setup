import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();
const note = z.object({ id: z.number(), text: z.string(), createdAt: z.string() });
const error = z.object({ error: z.string() });

export const notesContract = c.router({
  list: {
    method: "GET",
    path: "/api/notes",
    responses: { 200: z.object({ notes: z.array(note) }), 503: error },
  },
  create: {
    method: "POST",
    path: "/api/notes",
    body: z.object({ text: z.string().trim().min(1).max(200) }),
    responses: { 201: z.object({ note }), 400: error, 503: error },
  },
});
