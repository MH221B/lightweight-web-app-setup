import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1>Lightweight web app</h1>
      <Outlet />
    </main>
  );
}
