import { hc } from "hono/client";
import type { InferRequestType, InferResponseType } from "hono/client";
import type { AppType } from "../../server/src/app";

export const api = hc<AppType>("/");

export type NotesListResponse = InferResponseType<typeof api.api.notes.$get, 200>;
export type CreateNoteRequest = InferRequestType<typeof api.api.notes.$post>["json"];
export type Note = NotesListResponse["notes"][number];

export async function fetchNotes(): Promise<Note[]> {
  const res = await api.api.notes.$get();
  const body = await res.json();

  if (!res.ok || !("notes" in body)) {
    throw new Error("Could not load notes");
  }

  return body.notes;
}

export async function createNote(text: string): Promise<Note> {
  const res = await api.api.notes.$post({ json: { text } });
  const body = await res.json();

  if ("note" in body) {
    return body.note;
  }

  throw new Error("error" in body ? body.error : "Could not save note");
}
