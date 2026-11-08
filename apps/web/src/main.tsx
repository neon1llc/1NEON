// apps/web/src/main.tsx - Web app entry: data cache, toasts, and the route table under /1NEON.


import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { ToastProvider } from "./components/ui.tsx";
import { AllLayout, OrgLayout, PlainLayout, Root } from "./components/Shell.tsx";
import { AllWorkflow } from "./pages/AllWorkflow.tsx";
import { Documents } from "./pages/Documents.tsx";
import { Insights } from "./pages/Insights.tsx";
import { Faqs } from "./pages/Faqs.tsx";
import { LayerPage } from "./pages/LayerPage.tsx";
import { Legal } from "./pages/Legal.tsx";
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


// Data stays fresh for 10 seconds; HTTP errors (401, 403, 404) are answers, not reasons to retry
const queries = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: (n, e) => n < 2 && !("status" in (e as object)) } },
});


// Routes. /o/:slug is one organization, /all is the operator's read-only view, /me is the profile
const router = createBrowserRouter(
  [
    // Public pages: no sign-in needed, so they sit outside Root's gate
    { path: "privacy", element: <Legal doc="privacy" /> },
    { path: "terms", element: <Legal doc="terms" /> },
    { path: "cookies", element: <Legal doc="cookies" /> },
    { path: "faqs", element: <Faqs /> },
    { path: "faq", element: <Navigate to="/faqs" replace /> },
    { path: "help", element: <Navigate to="/faqs" replace /> },
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
            { path: "insights", element: <Insights /> },
            { path: "settings", element: <Settings /> },
          ],
        },
        { path: "all", element: <AllLayout />, children: [{ index: true, element: <Navigate to="workflow" replace /> }, { path: "workflow", element: <AllWorkflow /> }] },
        { element: <PlainLayout />, children: [{ path: "me", element: <MePage /> }] },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: "/1NEON" },
);


// Mount the app
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);


// Neo, the site's assistant window, answered from neon1's public pages through /chat/api on this
// origin. Dark on the sign-in screen, light in the app; optional: if the site's module can't
// load, the portal works without it
const CHAT = "/shared/chat.js";
type ChatOptions = { className?: string; light?: () => boolean; watch?: Element[] };
import(/* @vite-ignore */ CHAT)
  .then((m: { chat(opts: ChatOptions): unknown }) =>
    m.chat({ className: "n1chat-portal n1chat-right", light: () => !document.querySelector(".signin"), watch: [document.getElementById("root")!] }),
  )
  .catch(() => undefined);
