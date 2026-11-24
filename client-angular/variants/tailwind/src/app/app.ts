import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  template: `
    <main class="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <h1>Lightweight web app</h1>
      <router-outlet />
    </main>
  `,
})
export class App {}
