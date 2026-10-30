import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { createNote, fetchNotes } from "../api";

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
    <section>
      <h2>Notes</h2>

      <form onSubmit={submit}>
        <label htmlFor="note">New note</label>
        <input
          id="note"
          name="note"
          value={text}
          onChange={(event) => setText(event.target.value)}
          minLength={1}
          maxLength={200}
          required
        />
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "Saving..." : "Add note"}
        </button>
      </form>

      {create.isError ? <p role="alert">{create.error.message}</p> : null}

      {notes.isPending ? <p>Loading notes...</p> : null}
      {notes.isError ? <p role="alert">Could not load notes.</p> : null}
      {notes.data?.length === 0 ? <p>No notes yet.</p> : null}

      <ul>
        {notes.data?.map((note) => (
          <li key={note.id}>{note.text}</li>
        ))}
      </ul>
    </section>
  );
}
