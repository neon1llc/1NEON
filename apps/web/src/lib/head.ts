// apps/web/src/lib/head.ts - Each route's title, description, and indexing intent (docs/routes.md is
// the map in prose). Public pages meant for search get a real title, description, and canonical
// address; sign-in, account pages, the demo, and the walkthrough say noindex. Set from code, never
// an inline script, so the page's CSP stays as it is. Access control is the API's job, not this.


/** What one route puts in the document head */
export interface Head {
  title: string;
  description: string;
  /** noindex: keep this route out of search results (it stays crawlable, so the tag is seen) */
  noindex?: boolean;
  /** The address search engines should credit, when the route has one */
  canonical?: string;
}


const SITE = "https://neon1.tech";
const PORTAL = "1NEON client portal by neon1.";

// Signed-in pages, named by the part of the address after the organization
const SECTIONS: Record<string, string> = {
  workspace: "Home", workflow: "Board", projects: "Projects", documents: "Files", insights: "Insights",
  people: "People", settings: "Settings", layer: "Layer", me: "Profile", all: "All clients",
};


/** The head for a full pathname (with /1NEON), from the route intent map */
export function headFor(pathname: string): Head {
  const path = pathname.replace(/\/+$/, "") || "/";
  // Temporary, in-browser routes: useful to visit, not to rank
  if (path === "/1NEON/live" || path.startsWith("/1NEON/live/")) {
    return { title: "Guided walkthrough · 1NEON", description: "A fictional project played on the real 1NEON portal, in about a minute. No account needed.", noindex: true };
  }
  if (path === "/1NEON/demo" || path.startsWith("/1NEON/demo/")) {
    const section = sectionOf(path.slice("/1NEON/demo".length));
    return { title: `${section ? `${section} · ` : ""}Interactive demo · 1NEON`, description: "A working copy of the 1NEON portal with made-up clients. Everything stays in your browser.", noindex: true };
  }
  // Public pages for search and sharing
  if (path === "/1NEON/example") {
    return { title: "Sample project: orders without retyping · 1NEON", description: "One made-up bakery project in the 1NEON portal, from the request to the handover, through Needs, Execute, Observe, and Normalize.", canonical: `${SITE}/1NEON/example` };
  }
  if (path === "/1NEON/faqs") {
    // The same answers are published in the knowledge center, which is the copy to credit
    return { title: "1NEON FAQs · neon1", description: "Short answers about using the 1NEON client portal: signing in, projects, approvals, files, access, support, and your data.", canonical: `${SITE}/knowledge/faq/1neon-help/` };
  }
  if (path === "/1NEON/privacy") return { title: "Privacy policy · 1NEON", description: `What information the portal collects, why, and what you can do about it. ${PORTAL}` };
  if (path === "/1NEON/terms") return { title: "Terms of use · 1NEON", description: `The terms for using neon1.tech and the 1NEON portal. ${PORTAL}` };
  if (path === "/1NEON/cookies") return { title: "Cookies and browser storage · 1NEON", description: `The cookies the portal needs and what it saves in your browser. ${PORTAL}` };
  // Sign-in and everything behind it: for clients, not for search
  if (path === "/1NEON") return { title: "Sign in · 1NEON client portal", description: `Sign in to your projects. Access is by invitation. ${PORTAL}`, noindex: true };
  const section = sectionOf(path.slice("/1NEON".length));
  return { title: `${section ? `${section} · ` : ""}1NEON`, description: PORTAL, noindex: true };
}

// "/o/acme/projects/PRJ-1" is Projects; "/me" is Profile
function sectionOf(rest: string) {
  const parts = rest.split("/").filter(Boolean);
  const key = parts[0] === "o" ? parts[2] : parts[0];
  return key ? SECTIONS[key] : undefined;
}


// --- Applying it ------------------------------------------------------------------

/** Find or make one head element, or remove it when there's nothing to say */
function tag(selector: string, make: () => HTMLElement, set: ((el: HTMLElement) => void) | undefined) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!set) return void el?.remove();
  if (!el) el = document.head.appendChild(make());
  set(el);
}

/** Put a route's head into the document */
export function applyHead(h: Head) {
  document.title = h.title;
  const meta = (name: string) => () => Object.assign(document.createElement("meta"), { name });
  tag('meta[name="description"]', meta("description"), (el) => el.setAttribute("content", h.description));
  tag('meta[name="robots"]', meta("robots"), h.noindex ? (el) => el.setAttribute("content", "noindex") : undefined);
  tag('link[rel="canonical"]', () => Object.assign(document.createElement("link"), { rel: "canonical" }), h.canonical ? (el) => el.setAttribute("href", h.canonical!) : undefined);
}
