import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "@client/routeTree.gen";
import "./styles.scss";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: () => <p>Loading...</p>,
  defaultErrorComponent: ({ error }) => (
    <p role="alert">{error instanceof Error ? error.message : String(error)}</p>
  ),
  defaultNotFoundComponent: () => <p>Not found</p>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
