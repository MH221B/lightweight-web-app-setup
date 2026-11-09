import { createORPCClient, ORPCError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { notesContract } from "@shared/notes.contract";

const link = new OpenAPILink(notesContract, {
  url: () => globalThis.location.origin,
  customErrorResponseBodyDecoder(body, response) {
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return new ORPCError("NOTES_HTTP_ERROR", { status: response.status, message: body.error });
    }
    return null;
  },
});
const api: JsonifiedClient<ContractRouterClient<typeof notesContract>> = createORPCClient(link);
export type Note = Awaited<ReturnType<typeof api.list>>["notes"][number];

export async function fetchNotes(): Promise<Note[]> {
  try {
    return (await api.list()).notes;
  } catch {
    throw new Error("Could not load notes");
  }
}

export async function createNote(text: string): Promise<Note> {
  try {
    return (await api.create({ text })).note;
  } catch (error) {
    throw new Error(
      error instanceof ORPCError && error.code === "NOTES_HTTP_ERROR"
        ? error.message
        : "Could not save note",
    );
  }
}
