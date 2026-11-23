import { Injectable, inject } from "@angular/core";
import { QueryClient, injectMutation, injectQuery } from "@tanstack/angular-query";
import { createNote, fetchNotes } from "@shared/api";

const notesQueryKey = ["notes"] as const;

@Injectable({ providedIn: "root" })
export class NotesService {
  private readonly queryClient = inject(QueryClient);

  readonly notes = injectQuery(() => ({
    queryKey: notesQueryKey,
    queryFn: fetchNotes,
  }));

  readonly createNote = injectMutation(() => ({
    mutationFn: createNote,
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: notesQueryKey }),
  }));
}
