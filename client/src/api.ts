import { initClient } from "@ts-rest/core";
import { notesContract } from "@shared/notes.contract";
import type { z } from "zod";

const api = initClient(notesContract, { baseUrl: "", baseHeaders: {} });
export type Note = z.infer<(typeof notesContract.list.responses)[200]>["notes"][number];

export async function fetchNotes(): Promise<Note[]> {
  const res = await api.list();
  if (res.status !== 200) throw new Error("Could not load notes");
  return res.body.notes;
}

export async function createNote(text: string): Promise<Note> {
  const res = await api.create({ body: { text } });
  if (res.status === 201) return res.body.note;
  throw new Error(
    typeof res.body === "object" && res.body && "error" in res.body
      ? String(res.body.error)
      : "Could not save note",
  );
}
