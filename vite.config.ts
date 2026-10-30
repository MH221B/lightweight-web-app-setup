import { defineConfig } from "vite-plus";

// Workspace-wide static checks. Run `bun run check` (or `vp check`) from the
// repository root so both `client/` and `server/` are covered.
export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: [
      "client/dist/**",
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
      "client/dist/**",
      "client/src/routeTree.gen.ts",
      "client/.tanstack/**",
      "server/data/**",
      "server/drizzle/**",
      "docs/**",
    ],
  },
});
