import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import React from "react";
import { createRoot } from "react-dom/client";
import "./i18n.js";
import "./styles.css";
import { AppShell } from "./shell/AppShell.js";
import { NavLinks } from "./shell/NavLinks.js";
import { SettingsPage } from "./views/SettingsPage.js";
import { WorldPage } from "./views/WorldPage.js";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: () => (
    <AppShell nav={<NavLinks />}>
      <Outlet />
    </AppShell>
  )
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorldPage
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage
});

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
