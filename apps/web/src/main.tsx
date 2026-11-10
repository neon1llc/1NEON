// apps/web/src/main.tsx - Web app entry: data cache, toasts, and the route table under /1NEON.


import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { RouteError } from "./components/Reads.tsx";
import { AskProvider, ToastProvider } from "./components/ui.tsx";
import { AllLayout, OrgLayout, PlainLayout, Root } from "./components/Shell.tsx";
import { Faqs } from "./pages/Faqs.tsx";
import { Legal } from "./pages/Legal.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { BASE_PATH, DEMO, devUser, LIVE } from "./lib/api.ts";
import { setCache, setNavigate } from "./lib/nav.ts";
import { offline } from "./lib/reads.ts";
import { Example } from "./pages/Example.tsx";
import "./styles/app.css";


// Signed-in pages load on first visit, so the sign-in screen and the public pages don't download the
// whole app first. Each module is fetched once; while it loads, the page in view stays put
const page = <K extends string>(load: () => Promise<Record<K, () => React.ReactNode>>, name: K) => () =>
  load().then((m) => ({ Component: m[name] }));


// Data stays fresh for 10 seconds. Only a dropped connection retries on its own (twice); an HTTP answer
// or a malformed reply is shown at once, with the page's own Try again
const queries = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: (n, e) => n < 2 && offline(e) } },
});


// Routes. /o/:slug is one organization, /all is the operator's read-only view, /me is the profile.
// A page that throws while rendering shows RouteError: inside the frame for signed-in pages, so the
// menu still works, and on its own for anything above that
const router = createBrowserRouter(
  [
    // Public pages: no sign-in needed, so they sit outside Root's gate
    { path: "privacy", element: <Legal doc="privacy" />, errorElement: <RouteError /> },
    { path: "terms", element: <Legal doc="terms" />, errorElement: <RouteError /> },
    { path: "cookies", element: <Legal doc="cookies" />, errorElement: <RouteError /> },
    { path: "faqs", element: <Faqs />, errorElement: <RouteError /> },
    { path: "example", element: <Example />, errorElement: <RouteError /> },
    { path: "faq", element: <Navigate to="/faqs" replace /> },
    { path: "help", element: <Navigate to="/faqs" replace /> },
    {
      path: "/",
      element: <Root />,
      errorElement: <RouteError />,
      children: [
        {
          path: "o/:slug",
          element: <OrgLayout />,
          children: [{ errorElement: <RouteError inFrame />, children: [
            { index: true, element: <Navigate to="workspace" replace /> },
            { path: "workspace", lazy: page(() => import("./pages/Workspace.tsx"), "WorkspacePage") },
            { path: "workflow", lazy: page(() => import("./pages/Workflow.tsx"), "Workflow") },
            { path: "projects", lazy: page(() => import("./pages/Projects.tsx"), "Projects") },
            { path: "projects/new", lazy: page(() => import("./pages/NewProject.tsx"), "NewProject") },
            { path: "projects/:key", lazy: page(() => import("./pages/Project.tsx"), "ProjectPage") },
            { path: "projects/:key/:tab", lazy: page(() => import("./pages/Project.tsx"), "ProjectPage") },
            { path: "layer/:layer", lazy: page(() => import("./pages/LayerPage.tsx"), "LayerPage") },
            { path: "people", lazy: page(() => import("./pages/People.tsx"), "People") },
            { path: "documents", lazy: page(() => import("./pages/Documents.tsx"), "Documents") },
            { path: "insights", lazy: page(() => import("./pages/Insights.tsx"), "Insights") },
            { path: "settings", lazy: page(() => import("./pages/Settings.tsx"), "Settings") },
          ] }],
        },
        { path: "all", element: <AllLayout />, children: [{ errorElement: <RouteError inFrame />, children: [{ index: true, element: <Navigate to="workflow" replace /> }, { path: "workflow", lazy: page(() => import("./pages/AllWorkflow.tsx"), "AllWorkflow") }] }] },
        { element: <PlainLayout />, children: [{ errorElement: <RouteError inFrame />, children: [{ path: "me", lazy: page(() => import("./pages/Me.tsx"), "MePage") }] }] },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: BASE_PATH },
);


// Mount the app
// The live playback always starts at the person picker, from a fresh story
if (LIVE) devUser.set("");

// Code outside React (the live playback) navigates through the same router
setNavigate((to) => void router.navigate(to));
setCache({ invalidateQueries: () => queries.invalidateQueries(), clear: () => queries.clear() });
// A write that got no answer may still have happened: re-read everything on screen (safe GETs) so the
// page shows the real outcome. The write itself is never sent again on its own
// Sign-in steps check their own outcome (re-reading the session here would reset the sign-in form)
addEventListener("1neon:unconfirmed", (e) => {
  if (!String((e as CustomEvent<{ path?: string }>).detail?.path).startsWith("/auth/")) void queries.invalidateQueries();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      {/* Toasts and the are-you-sure dialog reach every page */}
      <ToastProvider>
        <AskProvider>
          <RouterProvider router={router} />
        </AskProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);


// Neo, the site's assistant window, answered from neon1's public pages through /chat/api on this
// origin. Dark on the sign-in screen, light in the app; optional: if the site's module can't
// load, the portal works without it
const CHAT = "/shared/chat.js";
type ChatOptions = { className?: string; light?: () => boolean; watch?: Element[] };
// The demo makes no calls at all, so it leaves Neo out
if (!DEMO) import(/* @vite-ignore */ CHAT)
  .then((m: { chat(opts: ChatOptions): unknown }) =>
    m.chat({ className: "n1chat-portal n1chat-right", light: () => !document.querySelector(".signin"), watch: [document.getElementById("root")!] }),
  )
  .catch(() => undefined);


// /1NEON/live: the controls above the portal, then the story starts playing once the page settles
if (LIVE) {
  void Promise.all([import("./live/player.ts"), import("./live/story.ts"), import("./live/LiveBar.tsx")]).then(([{ Player }, { STORY }, { LiveBar }]) => {
    const player = new Player(STORY);
    // The controls live outside #root, so they stay reachable while the portal underneath is inert
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "live-layer";
    createRoot(host).render(<LiveBar player={player} />);
    setTimeout(() => player.start(), 1200);
  });
}
