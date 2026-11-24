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
    <section className="panel">
      <h2>Notes</h2>

      <form className="note-form" onSubmit={submit}>
        <label htmlFor="note">New note</label>
        <input
          id="note"
          name="note"
          value={text}
          onChange={(event) => setText(event.target.value)}
          minLength={1}
          maxLength={NOTE_MAX_LENGTH}
          required
        />
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? "Saving..." : "Add note"}
        </button>
      </form>

      {create.isError ? (
        <p className="status status--error" role="alert">
          {create.error.message}
        </p>
      ) : null}

      {notes.isPending ? <p className="status">Loading notes...</p> : null}
      {notes.isError ? (
        <p className="status status--error" role="alert">
          {notes.error.message}
        </p>
      ) : null}
      {notes.data?.length === 0 ? <p className="status">No notes yet.</p> : null}

      <ul className="note-list">
        {notes.data?.map((note) => (
          <li className="note" key={note.id}>
            {note.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
