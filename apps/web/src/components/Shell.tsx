// apps/web/src/components/Shell.tsx - App frame: sign-in gate, sidebar with the organization
// chooser, top bar, and the org context.


import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { api, devUser, HttpError, isDev, signInUrl } from "../lib/api.ts";
import type { Me, OrgResponse, OrgSummary } from "../lib/types.ts";
import { Rain } from "./Rain.tsx";
import { Avatar, LayerBadge, LAYERS, layerName } from "./ui.tsx";


// --- Session -----------------------------------------------------------------


/** The signed-in person and their organizations; a 401 here means "show sign-in" */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false });
}


// Session context for everything below Root
const MeCtx = createContext<Me | null>(null);
// Only valid inside Root, after sign-in
export const useSession = () => useContext(MeCtx)!;


/** Apply the saved theme; "system" defers to the device setting */
function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}


/** Top-level gate: sign-in, error, first-visit redirect, then the app */
export function Root() {
  const me = useMe();
  const loc = useLocation();
  useEffect(() => {
    if (me.data) applyTheme(me.data.user.theme);
  }, [me.data]);
  if (me.isPending) return <div className="content muted" aria-busy="true">Loading…</div>;
  if (me.error) {
    if (me.error instanceof HttpError && me.error.status === 401) return <SignIn />;
    return <div className="content">Couldn't reach 1NEON. <button className="linkish" onClick={() => me.refetch()}>Try again</button></div>;
  }
  const data = me.data!;
  // Landing on /1NEON/: the operator starts at All clients, everyone else in their first client organization
  if (loc.pathname === "/" || loc.pathname === "") {
    const first = data.orgs.find((o) => o.slug !== "neon1") ?? data.orgs[0];
    if (data.operator) return <Navigate to="/all/workflow" replace />;
    if (first) return <Navigate to={`/o/${first.slug}/workspace`} replace />;
    return <div className="content"><h1 className="page-title">1NEON</h1><p className="lead">You're signed in, but not part of any organization yet. Ask neon1 or your organization's admin for an invite.</p></div>;
  }
  return (
    <MeCtx.Provider value={data}>
      <div className="wake" style={{ height: "100%" }}>
        <Outlet />
      </div>
    </MeCtx.Provider>
  );
}


// --- Sign-in -------------------------------------------------------------------


// Local demo accounts; the buttons only render in a dev build
const DEMO = [
  ["pradeep@neon1.tech", "Pradeep (neon1 operator)"],
  ["raj@acmedental.example", "Raj Patel (Acme Dental admin)"],
  ["dana@acmedental.example", "Dana Kim (Acme Dental editor)"],
  ["lee@harborauto.example", "Lee Moreno (Harbor Auto, invited)"],
] as const;


/** Sign-in: email first, then Cognito Managed Login (code, passkey, or Google) */
function SignIn() {
  const [email, setEmail] = useState("");
  const qc = useQueryClient();
  const params = new URLSearchParams(location.search);
  // The API's callback sends people back here with a reason when sign-in can't finish
  const problem = params.get("signin");
  // Dev sign-in: remember the demo email and refetch everything as that person
  const pick = (e: string) => {
    devUser.set(e);
    qc.invalidateQueries();
  };
  return (
    <main className="signin">
      <Rain panes=".signin .panel, .signin .home, .rainctl button" />
      <div className="veil" />
      {/* Back to neon1.tech, where the site's own logo sits */}
      <a className="home glass" href="/" aria-label="neon1.tech home">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6a24 24 0 0 1 24 24v30M6 12a18 18 0 0 1 18 18v30M6 18a12 12 0 0 1 12 12v30M6 24a6 6 0 0 1 6 6v30" />
          <path d="M34 6a24 24 0 0 1 24 24v30M34 12a18 18 0 0 1 18 18v30M34 18a12 12 0 0 1 12 12v30M34 24a6 6 0 0 1 6 6v30" />
        </svg>
        <span><span className="ne">neon</span><span className="one">1</span></span>
      </a>
      <div className="panel glass">
        <h1 className="word">1NEON</h1>
        <span className="tag">1 portal. Needs. Execution. Observation. Next.</span>
        {/* Sign-in problems from the callback, then the email form */}
        {problem === "not_invited" && <p className="notice" role="alert">That email hasn't been invited yet. Ask your organization's admin, or neon1.</p>}
        {problem === "failed" && <p className="notice" role="alert">Sign-in didn't finish. Please try again.</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            location.href = signInUrl(email.trim());
          }}
        >
          <label className="sr" htmlFor="email">Your email</label>
          <input id="email" type="email" autoComplete="email webauthn" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-primary" type="submit">Continue</button>
        </form>
        <p className="fine">Sign in with a code by email, a passkey, or Google. 1NEON uses only the cookies it needs to keep you signed in.</p>
        {/* The three policies on one line of their own */}
        <p className="fine legal-links">
          <Link to="/cookies">Cookies</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
        </p>
        {/* Demo accounts exist only in local builds */}
        {isDev && (
          <div className="dev" aria-label="Local demo accounts">
            <p className="fine" style={{ margin: "6px 0 0" }}>Local demo: sign in as</p>
            {DEMO.map(([e, label]) => (
              <button key={e} onClick={() => pick(e)}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}


// --- Organization context ---------------------------------------------------------


/** The organization in view, its stages, and what the caller may do in it */
interface OrgCtxValue extends OrgResponse {
  summary: OrgSummary;
  canWrite: boolean;
  canAdmin: boolean;
}
// Organization context for everything inside OrgLayout
const OrgCtx = createContext<OrgCtxValue | null>(null);
// Only valid inside OrgLayout
export const useOrg = () => useContext(OrgCtx)!;


/** Routes under /o/:slug: resolve the slug from the person's own list, then load the organization */
export function OrgLayout() {
  const me = useSession();
  const { slug } = useParams();
  const summary = me.orgs.find((o) => o.slug === slug);
  const org = useQuery({ queryKey: ["org", summary?.id], queryFn: () => api<OrgResponse>(`/t/${summary!.id}`), enabled: Boolean(summary) });
  // Not in my list: show "not here" without asking the API about an organization I can't see
  if (!summary) return <Frame><NotMember /></Frame>;
  if (!org.data) return <Frame org={summary}><div className="content muted" aria-busy="true">Loading…</div></Frame>;
  const access = org.data.access;
  const value: OrgCtxValue = { ...org.data, summary, canWrite: access !== "viewer", canAdmin: access === "admin" };
  return (
    <OrgCtx.Provider value={value}>
      <Frame org={summary}>
        <Outlet />
      </Frame>
    </OrgCtx.Provider>
  );
}


/** The All clients view, operator only */
export function AllLayout() {
  const me = useSession();
  if (!me.operator) return <Frame><NotMember /></Frame>;
  return (
    <Frame all>
      <Outlet />
    </Frame>
  );
}


// One answer for missing and forbidden, so nobody learns which organizations exist
function NotMember() {
  return (
    <div className="content">
      <h1 className="page-title">Not here</h1>
      <p className="lead">That organization doesn't exist, or you don't have access to it.</p>
      <Link className="btn btn-ghost" to="/">Go to my workspace</Link>
    </div>
  );
}


// --- Frame: sidebar + top bar ----------------------------------------------------


// The top bar's content is set by the page in view
const Crumbs = createContext<(c: ReactNode) => void>(() => undefined);
/** Pages set their breadcrumb trail and presence avatars in the top bar */
export function useTopBar(node: ReactNode, deps: unknown[]) {
  const set = useContext(Crumbs);
  useEffect(() => {
    set(node);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}


/** Sidebar, top bar, and content area shared by every signed-in page */
function Frame({ org, all, children }: { org?: OrgSummary; all?: boolean; children: ReactNode }) {
  const me = useSession();
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState<ReactNode>(null);
  const loc = useLocation();
  // Close the phone drawer after navigating
  useEffect(() => setOpen(false), [loc.pathname]);
  const base = org ? `/o/${org.slug}` : "";
  return (
    <div className="shell">
      {/* Sidebar: brand, organization chooser, navigation, and the signed-in person */}
      <aside className={`side${open ? " open" : ""}`} aria-label="Sidebar">
        <Link className="brand" to="/">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="5" aria-hidden="true">
            <circle cx="32" cy="32" r="28" /><circle cx="32" cy="32" r="19" /><circle cx="32" cy="32" r="10" /><circle cx="32" cy="32" r="2" />
          </svg>
          1NEON
        </Link>
        {/* Organization pages get the hubs and layers; All clients gets only its board */}
        <OrgChooser current={org} all={all} />
        <ul className="nav">
          {org ? (
            <>
              <li><NavLink to={`${base}/workspace`}><span className="ico" aria-hidden="true">⌂</span>Workspace</NavLink></li>
              <li><NavLink to={`${base}/workflow`}><span className="ico" aria-hidden="true">▦</span>Workflow</NavLink></li>
              <li className="sep" aria-hidden="true">LAYERS</li>
              {LAYERS.map((l) => (
                <li key={l}><NavLink to={`${base}/layer/${l}`}><LayerBadge layer={l} />{layerName(l)}</NavLink></li>
              ))}
              <li className="sep" aria-hidden="true">HUBS</li>
              <li><NavLink to={`${base}/projects`} end={false}><span className="ico" aria-hidden="true">◫</span>Projects</NavLink></li>
              <li><NavLink to={`${base}/people`}><span className="ico" aria-hidden="true">◍</span>People</NavLink></li>
              <li><NavLink to={`${base}/documents`}><span className="ico" aria-hidden="true">▤</span>Documents</NavLink></li>
              <li><NavLink to={`${base}/settings`}><span className="ico" aria-hidden="true">⚙</span>Settings</NavLink></li>
            </>
          ) : all ? (
            <li><NavLink to="/all/workflow"><span className="ico" aria-hidden="true">▦</span>Workflow</NavLink></li>
          ) : null}
        </ul>
        {/* The way back to the neon1.tech site, outside the app's routes */}
        <a className="site-link" href="/">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6a24 24 0 0 1 24 24v30M6 12a18 18 0 0 1 18 18v30M6 18a12 12 0 0 1 12 12v30M6 24a6 6 0 0 1 6 6v30" />
              <path d="M34 6a24 24 0 0 1 24 24v30M34 12a18 18 0 0 1 18 18v30M34 18a12 12 0 0 1 12 12v30M34 24a6 6 0 0 1 6 6v30" />
            </svg>
          neon1.tech
        </a>
        {/* The signed-in person links to their profile */}
        <div className="foot">
          <Link to="/me" className="who" style={{ color: "inherit", textDecoration: "none" }}>
            <Avatar id={me.user.id} name={me.user.name || me.user.email} />
            <span>{me.user.name || me.user.email}</span>
          </Link>
          <span style={{ marginLeft: "auto" }} title="Connected"><span className="dot" aria-hidden="true" /><span className="sr">Connected</span></span>
        </div>
      </aside>
      <div className="main">
        {/* All clients is read only; say so on every screen of it */}
        {all && (
          <div className="readonly-bar" role="status">
            <strong>All clients · read only.</strong> Open a client to make changes.
          </div>
        )}
        {/* Top bar: the phone menu button and whatever the page put in the crumb slot */}
        <header className="top">
          <button className="chip only-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">menu</button>
          <div className="crumb">{top}</div>
          <span className="spacer" />
          <span className="hide-sm muted small">Commands <span className="kbd">⌘K</span></span>
        </header>
        <Crumbs.Provider value={setTop}>
          <main className="content" id="main">{children}</main>
        </Crumbs.Provider>
      </div>
    </div>
  );
}


/** The organization switcher at the top of the sidebar */
function OrgChooser({ current, all }: { current?: OrgSummary; all?: boolean }) {
  const me = useSession();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // Close the menu on any click outside it
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, []);
  // People in one organization see its name, not a chooser
  const many = me.operator || me.orgs.length > 1;
  const label = all ? "All clients" : current?.name ?? "Choose";
  const sub = all ? "read only" : current?.clientId ?? "";
  const list = me.orgs.filter((o) => (o.name + o.clientId).toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={`org${all ? " all" : ""}`} onClick={() => many && setOpen(!open)} aria-haspopup={many ? "listbox" : undefined} aria-expanded={open} disabled={!many && !current}>
        <b>{label}{many && <span aria-hidden="true">▾</span>}</b>
        <small>{sub}</small>
      </button>
      {open && (
        <div className="menu" role="listbox" style={{ top: "calc(100% + 6px)", left: 0, right: 0 }}>
          {me.orgs.length > 6 && <input aria-label="Search organizations" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} autoFocus />}
          {/* The operator can always jump to All clients */}
          {me.operator && (
            <>
              <button role="option" aria-selected={all} onClick={() => { setOpen(false); nav("/all/workflow"); }}>
                All clients <small>read only</small>
              </button>
              <hr />
            </>
          )}
          {list.map((o) => (
            <button key={o.id} role="option" aria-selected={o.id === current?.id} onClick={() => { setOpen(false); nav(`/o/${o.slug}/workspace`); }}>
              {o.name} <small>{o.clientId}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
