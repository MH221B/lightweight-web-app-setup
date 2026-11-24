import { Component, computed, inject, signal } from "@angular/core";
import { FormField, form, maxLength, required } from "@angular/forms/signals";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";
import { NotesService } from "./notes.service";

@Component({
  selector: "app-notes-page",
  imports: [FormField],
  template: `
    <section class="panel">
      <h2 class="text-balance">Notes</h2>

      <form class="note-form" (submit)="submit($event)">
        <label for="note">New note</label>
        <input id="note" [formField]="noteForm.text" />
        <button type="submit" [disabled]="createNote.isPending()">
          {{ createNote.isPending() ? "Saving..." : "Add note" }}
        </button>
      </form>

      @if (createNote.isError()) {
        <p class="status status--error" role="alert">{{ createNote.error()?.message }}</p>
      }

      @if (notes.isPending()) {
        <p class="status">Loading notes...</p>
      }
      @if (notes.isError()) {
        <p class="status status--error" role="alert">{{ notes.error()?.message }}</p>
      }
      @if (notes.data()?.length === 0) {
        <p class="status">No notes yet.</p>
      }

      <ul class="note-list">
        @for (note of noteList(); track note.id) {
          <li class="note">{{ note.text }}</li>
        }
      </ul>
    </section>
  `,
  styleUrl: "./notes-page.scss",
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
