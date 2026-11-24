import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { createNote, fetchNotes } from "@shared/api";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";

export const Route = createFileRoute("/")({
  component: NotesPage,
});

const notesQueryKey = ["notes"] as const;

function NotesPage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const notes = useQuery({
    queryKey: notesQueryKey,
    queryFn: fetchNotes,
  });

  const create = useMutation({
    mutationFn: createNote,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notesQueryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;

    create.mutate(value, {
      onSuccess: () => setText(""),
    });
  }

  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h2 className="mb-3 text-xl font-semibold">Notes</h2>

      <form
        className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 max-[40rem]:grid-cols-1"
        onSubmit={submit}
      >
        <label className="col-span-full text-sm text-muted" htmlFor="note">
          New note
        </label>
        <input
          className="min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          id="note"
          name="note"
          value={text}
          onChange={(event) => setText(event.target.value)}
          minLength={1}
          maxLength={NOTE_MAX_LENGTH}
          required
        />
        <button
          className="cursor-pointer rounded-lg bg-accent px-3 py-2 font-semibold text-accent-ink hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-progress disabled:opacity-70 max-[40rem]:w-full"
          type="submit"
          disabled={create.isPending}
        >
          {create.isPending ? "Saving..." : "Add note"}
        </button>
      </form>

      {create.isError ? (
        <p className="mt-3 text-sm text-alert" role="alert">
          {create.error.message}
        </p>
      ) : null}

      {notes.isPending ? <p className="mt-3 text-sm text-muted">Loading notes...</p> : null}
      {notes.isError ? (
        <p className="mt-3 text-sm text-alert" role="alert">
          {notes.error.message}
        </p>
      ) : null}
      {notes.data?.length === 0 ? <p className="mt-3 text-sm text-muted">No notes yet.</p> : null}

      <ul className="mt-4 grid list-none gap-2 p-0">
        {notes.data?.map((note) => (
          <li
            className="rounded-lg border border-line border-l-[3px] border-l-accent bg-page px-3 py-2 [overflow-wrap:anywhere]"
            key={note.id}
          >
            {note.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
