import { Component, computed, inject, signal } from "@angular/core";
import { FormField, form, maxLength, required } from "@angular/forms/signals";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";
import { NotesService } from "./notes.service";

@Component({
  selector: "app-notes-page",
  imports: [FormField],
  template: `
    <section>
      <h2>Notes</h2>

      <form (submit)="submit($event)">
        <label for="note">New note</label>
        <input id="note" [formField]="noteForm.text" />
        <button type="submit" [disabled]="createNote.isPending()">
          {{ createNote.isPending() ? "Saving..." : "Add note" }}
        </button>
      </form>

      @if (createNote.isError()) {
        <p role="alert">{{ createNote.error()?.message }}</p>
      }

      @if (notes.isPending()) {
        <p>Loading notes...</p>
      }
      @if (notes.isError()) {
        <p role="alert">{{ notes.error()?.message }}</p>
      }
      @if (notes.data()?.length === 0) {
        <p>No notes yet.</p>
      }

      <ul>
        @for (note of noteList(); track note.id) {
          <li>{{ note.text }}</li>
        }
      </ul>
    </section>
  `,
})
export class NotesPage {
  private readonly notesService = inject(NotesService);
  private readonly model = signal({ text: "" });

  protected readonly notes = this.notesService.notes;
  protected readonly createNote = this.notesService.createNote;
  protected readonly noteList = computed(() => this.notes.data() ?? []);
  protected readonly noteForm = form(this.model, (path) => {
    required(path.text);
    maxLength(path.text, NOTE_MAX_LENGTH);
  });

  protected submit(event: Event) {
    event.preventDefault();
    const text = this.model().text.trim();
    if (!text) return;

    this.createNote.mutate(text, {
      onSuccess: () => this.model.set({ text: "" }),
    });
  }
}
