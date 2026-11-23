import { defineConfig } from "vite-plus";

// Workspace-wide static checks. Run `bun run check` (or `vp check`) from the
// repository root so every workspace is covered.
//
// client-angular is formatted here (Oxfmt handles Angular inline templates and
// .component.html files), but it is outside the lint leg on purpose: tsrs runs
// TypeScript 7, which Angular 22 rejects, and oxlint has no Angular template
// rules. Its gates are `ng build` and angular-eslint (the third step of `check`).
export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: [
      "cli/dist/**",
      "cli/templates/**",
      "cli/overlays/**",
      "client/dist/**",
      "client-angular/**",
      "client/src/routeTree.gen.ts",
      "client/.tanstack/**",
      "server/data/**",
      "server/drizzle/**",
      "docs/**",
    ],
  },
  fmt: {
    ignorePatterns: [
      "bun.lock",
      "cli/dist/**",
      "client/dist/**",
      "client-angular/dist/**",
      "client-angular/.angular/**",
      "client/src/routeTree.gen.ts",
      "client/.tanstack/**",
      "server/data/**",
      "server/drizzle/**",
      "docs/**",
    ],
  },
});
