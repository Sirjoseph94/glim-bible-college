import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyInitialTheme, ThemeProvider } from "./design/theme";
import { startOfflineQueue } from "./offline";
import { createAppRouter } from "./router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // No polling or refetching in background tabs (TRD §18.3).
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

const router = createAppRouter(queryClient);
applyInitialTheme();
startOfflineQueue();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
