import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <main className="page">
      <h1>Lightweight web app</h1>
      <Outlet />
    </main>
  );
}
