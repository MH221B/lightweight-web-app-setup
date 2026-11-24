import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  template: `
    <main class="page">
      <h1>Lightweight web app</h1>
      <router-outlet />
    </main>
  `,
  styleUrl: "./app.scss",
})
export class App {}
