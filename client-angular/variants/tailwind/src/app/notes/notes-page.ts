import { Component, computed, inject, signal } from "@angular/core";
import { FormField, form, maxLength, required } from "@angular/forms/signals";
import { NOTE_MAX_LENGTH } from "@shared/notes.contract";
import { NotesService } from "./notes.service";

@Component({
  selector: "app-notes-page",
  imports: [FormField],
  template: `
    <section class="mt-4 rounded-lg border border-line bg-surface p-4">
      <h2 class="mb-3 text-xl font-semibold">Notes</h2>

      <form
        class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 max-[40rem]:grid-cols-1"
        (submit)="submit($event)"
      >
        <label class="col-span-full text-sm text-muted" for="note">New note</label>
        <input
          class="min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          id="note"
          [formField]="noteForm.text"
        />
        <button
          class="cursor-pointer rounded-lg bg-accent px-3 py-2 font-semibold text-accent-ink hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-progress disabled:opacity-70 max-[40rem]:w-full"
          type="submit"
          [disabled]="createNote.isPending()"
        >
          {{ createNote.isPending() ? "Saving..." : "Add note" }}
        </button>
      </form>

      @if (createNote.isError()) {
        <p class="mt-3 text-sm text-alert" role="alert">{{ createNote.error()?.message }}</p>
      }

      @if (notes.isPending()) {
        <p class="mt-3 text-sm text-muted">Loading notes...</p>
      }
      @if (notes.isError()) {
        <p class="mt-3 text-sm text-alert" role="alert">{{ notes.error()?.message }}</p>
      }
      @if (notes.data()?.length === 0) {
        <p class="mt-3 text-sm text-muted">No notes yet.</p>
      }

      <ul class="mt-4 grid list-none gap-2 p-0">
        @for (note of noteList(); track note.id) {
          <li
            class="rounded-lg border border-line border-l-[3px] border-l-accent bg-page px-3 py-2 [overflow-wrap:anywhere]"
          >
            {{ note.text }}
          </li>
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
