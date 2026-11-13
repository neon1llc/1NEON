// apps/web/src/main.tsx - Web app entry: data cache, toasts, and the route table under /1NEON.


// First, before any schema runs: Zod without eval, which the CSP forbids
import "./lib/zod-config.ts";
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
import { applyHead, headFor } from "./lib/head.ts";
import { keepEdgeStill } from "./lib/edge.ts";
import { keepPageWithAddress, quietSkippedTransitions } from "./lib/motion.ts";
import { setCache, setNavigate } from "./lib/nav.ts";
import { offline } from "./lib/reads.ts";
import { Example } from "./pages/Example.tsx";
import "./styles/app.css";


// DuckDuckGo on iPhone: the body scrolls and the page stays still, so nothing scrolls by under its toolbar
keepEdgeStill();
// Quick tab changes cut a slide short; that is expected, never an error
quietSkippedTransitions();


// A walkthrough moves through many pages on its own. Each move replaces the address instead of adding
// to the history, so the browser's Back leaves the walkthrough for the page that linked to it, rather
// than stepping back through pages the story visited (which also pulled the page out from under it)
if (LIVE) {
  const replace = history.replaceState.bind(history);
  history.pushState = (data: unknown, unused: string, url?: string | URL | null) => replace(data, unused, url);
}


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
    { path: "agreement", element: <Legal doc="agreement" />, errorElement: <RouteError /> },
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
            { path: "projects/:key/proposal", lazy: page(() => import("./pages/Proposal.tsx"), "ProposalPage") },
            { path: "projects/:key/invoices/:iid", lazy: page(() => import("./pages/Invoice.tsx"), "InvoicePage") },
            { path: "agreement", lazy: page(() => import("./pages/Agreement.tsx"), "AgreementPage") },
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
// A link to a walkthrough remembers the exact spot it was clicked from (the answer it sits in), so
// the walkthrough's Exit comes back to that answer; the browser's referrer carries no #anchor
else addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a[href*='/1NEON/live']") : null;
  if (!a) return;
  const spot = a.closest("[id]:not(#root):not(#main)")?.id;
  try { sessionStorage.setItem("1neon.liveFrom", location.pathname + location.search + (spot ? `#${spot}` : location.hash)); } catch { /* storage blocked: Exit returns to the page's top */ }
}, true);

// Each route's title, description, and indexing intent (lib/head.ts, docs/routes.md), kept current
// as the address changes
const head = () => applyHead(headFor(location.pathname));
head();
router.subscribe(head);

// Code outside React (the live playback) navigates through the same router
setNavigate((to) => void router.navigate(to));
// A transition's page that lands after a newer navigation is put right (lib/motion.ts)
keepPageWithAddress(
  () => ({ key: router.state.location.key, idle: router.state.navigation.state === "idle" }),
  () => {
    // The router's place carries the base path, and going somewhere adds it, so it comes off first
    const at = router.state.location;
    const pathname = at.pathname.startsWith(BASE_PATH) ? at.pathname.slice(BASE_PATH.length) || "/" : at.pathname;
    void router.navigate({ pathname, search: at.search, hash: at.hash }, { replace: true, state: at.state });
  },
);
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
// origin. It takes the landing page's two looks: dark on the sign-in screen and in the Matrix theme
// (chosen, or "device" on a dark device), light in Awake. The html element's n1-dark class and the
// #root subtree are watched, so a theme change repaints it at once. Optional: if the site's module
// can't load, the portal works without it
const CHAT = "/shared/chat.js";
type ChatOptions = { className?: string; light?: () => boolean; watch?: Element[] };
// The demo makes no calls at all, so it leaves Neo out
if (!DEMO) import(/* @vite-ignore */ CHAT)
  .then((m: { chat(opts: ChatOptions): unknown }) =>
    m.chat({
      className: "n1chat-portal n1chat-right",
      light: () => !document.querySelector(".signin") && !document.documentElement.classList.contains("n1-dark"),
      watch: [document.documentElement],
    }),
  )
  .catch(() => undefined);


// /1NEON/live: the controls above the portal and the card that introduces the walkthrough
if (LIVE) {
  void Promise.all([import("./live/player.ts"), import("./live/story.ts"), import("./live/LiveBar.tsx")]).then(([{ Player }, { FULL }, { LiveBar }]) => {
    const player = new Player(FULL);
    // The controls live outside #root, so they stay reachable while the portal underneath is inert
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "live-layer";
    createRoot(host).render(<LiveBar player={player} />);
    // Nothing plays until the visitor presses Start on the card (or the bar, or Space): people read
    // at their own speed, and a page that moves by itself is hard to trust
  });
}
