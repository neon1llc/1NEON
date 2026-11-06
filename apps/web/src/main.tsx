// Web app entry: data cache, toasts, and the route table under /1NEON.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { ToastProvider } from "./components/ui.tsx";
import { AllLayout, OrgLayout, Root } from "./components/Shell.tsx";
import { AllWorkflow } from "./pages/AllWorkflow.tsx";
import { Documents } from "./pages/Documents.tsx";
import { LayerPage } from "./pages/LayerPage.tsx";
import { MePage } from "./pages/Me.tsx";
import { NewProject } from "./pages/NewProject.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { People } from "./pages/People.tsx";
import { ProjectPage } from "./pages/Project.tsx";
import { Projects } from "./pages/Projects.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Workflow } from "./pages/Workflow.tsx";
import { WorkspacePage } from "./pages/Workspace.tsx";
import "./styles/app.css";

// Data stays fresh for 10 seconds; HTTP errors (401, 403, 404) are answers, not reasons to retry.
const queries = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: (n, e) => n < 2 && !("status" in (e as object)) } },
});

// Routes. /o/:slug is one organization, /all is the operator's read-only view, /me is the profile.
const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Root />,
      children: [
        {
          path: "o/:slug",
          element: <OrgLayout />,
          children: [
            { index: true, element: <Navigate to="workspace" replace /> },
            { path: "workspace", element: <WorkspacePage /> },
            { path: "workflow", element: <Workflow /> },
            { path: "projects", element: <Projects /> },
            { path: "projects/new", element: <NewProject /> },
            { path: "projects/:key", element: <ProjectPage /> },
            { path: "projects/:key/:tab", element: <ProjectPage /> },
            { path: "layer/:layer", element: <LayerPage /> },
            { path: "people", element: <People /> },
            { path: "documents", element: <Documents /> },
            { path: "settings", element: <Settings /> },
          ],
        },
        { path: "all", element: <AllLayout />, children: [{ index: true, element: <Navigate to="workflow" replace /> }, { path: "workflow", element: <AllWorkflow /> }] },
        { path: "me", element: <MePage /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: "/1NEON" },
);

// Mount the app.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
