// apps/web/src/components/Shell.tsx - App frame: sign-in gate, sidebar with the organization
// chooser, top bar, and the org context.


import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { api, devUser, HttpError, isDev } from "../lib/api.ts";
import { passkeyAssertion } from "../lib/passkey.ts";
import { cleanCode, clearStep, loadStep, saveStep, session } from "../lib/signin.ts";
import type { Me, OrgResponse, OrgSummary } from "../lib/types.ts";
import { Rain } from "./Rain.tsx";
import { Avatar, Icon, initials, LayerBadge, LAYERS, layerName } from "./ui.tsx";


// --- Session -----------------------------------------------------------------


/** The signed-in person and their organizations; a 401 here means "show sign-in" */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false });
}


// Session context for everything below Root
const MeCtx = createContext<Me | null>(null);
// Only valid inside Root, after sign-in
export const useSession = () => useContext(MeCtx)!;


/** Apply a theme to the page; with no attribute the styles show awake */
export function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}


// Set by /arrive.js when someone came from neon1.tech's 1NEON link; the first sign-in screen uses it up
let arriving = document.documentElement.classList.contains("from-site");


/** Top-level gate: sign-in, error, first-visit redirect, then the app */
export function Root() {
  const me = useMe();
  const loc = useLocation();
  useEffect(() => {
    if (me.data) applyTheme(me.data.user.theme);
  }, [me.data]);
  // The black page from the site holds only until the first answer; the app then uses its own colors
  useEffect(() => {
    if (!me.isPending) document.documentElement.classList.remove("from-site");
  }, [me.isPending]);
  // Arriving from the site, the wait stays black like the site's fade; otherwise a quiet loading line
  if (me.isPending) return arriving ? <div className="signin" aria-busy="true" /> : <div className="content muted" aria-busy="true">Loading…</div>;
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


// What the API answers at each sign-in step
type Step = { step: "email" | "choose" | "code" | "totp" | "passkey" | "done" | "failed" | "not_invited"; methods?: ("code" | "passkey")[]; options?: unknown; wrong?: boolean };


// The wordmark's letters, each with the rest of the word it stands for
const SPELLED = [["1", "portal"], ["N", "eeds"], ["E", "xecute"], ["O", "bserve"], ["N", "ormalize"]] as const;


/** 1NEON that spells itself out on one line and folds back: once after load, then on hover, focus,
 * or tap. Its accessible name stays "1NEON", described by the full meaning */
function Wordmark() {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // Open now; with `hold`, fold back after that many milliseconds
  const show = (hold?: number) => {
    clearTimeout(timer.current);
    setOpen(true);
    if (hold) timer.current = window.setTimeout(() => setOpen(false), hold);
  };
  // Fold back now
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  // One unprompted spell-out shortly after load, skipped for reduced motion
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = window.setTimeout(() => show(2600), 900);
    return () => { clearTimeout(start); clearTimeout(timer.current); };
  }, []);
  return (
    <>
      <h1 className={`word${open ? " open" : ""}`} tabIndex={0} aria-label="1NEON" aria-describedby="word-meaning"
        onMouseEnter={() => show()} onMouseLeave={hide} onFocus={() => show()} onBlur={hide} onClick={() => show(2600)}>
        <span className="wm" aria-hidden="true">
          {SPELLED.map(([initial, rest], i) => (
            <span key={i} className="seg">
              <span className="init">{initial}</span>
              <span className="rest" style={{ "--n": rest.length } as CSSProperties}>{rest}</span>
            </span>
          ))}
        </span>
      </h1>
      <p id="word-meaning" className="sr">1 portal: Needs, Execute, Observe, Normalize</p>
    </>
  );
}


/** Sign-in on this page: email, then a code by email or a passkey, through the API */
function SignIn() {
  // A step saved before a reload comes back if it's still answerable
  const [saved] = useState(() => loadStep(session()));
  // Invite links carry the email, so it's filled in already
  const [email, setEmail] = useState(() => saved?.email ?? new URLSearchParams(location.search).get("email") ?? "");
  const [code, setCode] = useState("");
  const [at, setAt] = useState<Step>(() => (saved ? { step: saved.step, methods: saved.methods } : { step: "email" }));
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  // The Managed Login callback sends people back here with a reason when sign-in can't finish
  const problem = at.step === "failed" || at.step === "not_invited" ? at.step : new URLSearchParams(location.search).get("signin");
  // Dev sign-in: remember the demo email and refetch everything as that person
  const pick = (e: string) => {
    devUser.set(e);
    qc.invalidateQueries();
  };
  // One round trip to the API; a passkey step prompts the browser and answers right away
  const send = async (body: object) => {
    setBusy(true);
    try {
      let r = await api<Step>("/auth/step", { method: "POST", body });
      if (r.step === "passkey") r = await api<Step>("/auth/step", { method: "POST", body: { op: "answer", kind: "passkey", value: await passkeyAssertion(r.options as never) } });
      setCode("");
      // Keep a step that waits on the person; finishing or failing forgets it
      if (r.step === "choose" || r.step === "code" || r.step === "totp") saveStep(session(), { email: email.trim(), step: r.step, methods: r.methods });
      else clearStep(session());
      if (r.step === "done") await qc.invalidateQueries();
      else setAt(r);
    } catch {
      clearStep(session());
      setAt({ step: "failed" });
    }
    setBusy(false);
  };
  // A code link from the email: take the code from the fragment, clear it from the address, and
  // answer at once. The link only works in the browser holding the sign-in that sent the code
  const [fromLink, setFromLink] = useState(false);
  useEffect(() => {
    const m = /^#code=(\d{6,8})$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    setFromLink(true);
    void send({ op: "answer", kind: "code", value: m[1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Start over with another email, forgetting the saved step
  const restart = () => { clearStep(session()); setAt({ step: "email" }); setCode(""); };
  // Fade in only on the first sign-in screen after arriving from the site, not on a later return to it
  const [arrive] = useState(() => arriving);
  useEffect(() => { arriving = false; }, []);
  return (
    <main className={`signin${arrive ? " arrive" : ""}`}>
      <Rain panes=".signin .panel, .signin .n1-logo, .rainctl button" />
      <div className="veil" />
      {/* Back to neon1.tech, in the site's own top bar so the logo sits exactly where the site's does */}
      <header className="n1-bar">
        <div className="n1-inner">
          <a className="n1-logo glass" href="/" aria-label="neon1.tech home">
            <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6a24 24 0 0 1 24 24v30M6 12a18 18 0 0 1 18 18v30M6 18a12 12 0 0 1 12 12v30M6 24a6 6 0 0 1 6 6v30" />
              <path d="M34 6a24 24 0 0 1 24 24v30M34 12a18 18 0 0 1 18 18v30M34 18a12 12 0 0 1 12 12v30M34 24a6 6 0 0 1 6 6v30" />
            </svg>
            <span><span className="ne">neon</span><span className="one">1</span></span>
          </a>
        </div>
      </header>
      <div className="panel glass">
        <Wordmark />
        {problem === "not_invited" && <p className="notice" role="alert">That email hasn't been invited yet. Ask your organization's admin, or neon1.</p>}
        {problem === "failed" && <p className="notice" role="alert">{fromLink ? "That link only works in the browser where you asked for the code. Type the code there instead, or start again here." : "Sign-in didn't finish. Please try again."}</p>}
        {/* Step 1: the email */}
        {(at.step === "email" || at.step === "failed" || at.step === "not_invited") && (
          <form onSubmit={(e) => { e.preventDefault(); void send({ op: "start", email: email.trim() }); }}>
            <label className="sr" htmlFor="email">Your email</label>
            <input id="email" type="email" required autoComplete="email webauthn" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "One moment…" : "Continue"}</button>
          </form>
        )}
        {/* Step 2a: a passkey or a code, when both are on offer */}
        {at.step === "choose" && (
          <div className="steps-col">
            <p className="fine">Signing in as <b>{email}</b></p>
            {at.methods?.includes("passkey") && <button className="btn btn-primary" disabled={busy} onClick={() => void send({ op: "choose", method: "passkey" })}>Use my passkey</button>}
            {at.methods?.includes("code") && <button className="btn btn-ghost" disabled={busy} onClick={() => void send({ op: "choose", method: "code" })}>Email me a code</button>}
          </div>
        )}
        {/* Step 2b: the emailed code, or an authenticator app's code */}
        {(at.step === "code" || at.step === "totp") && (
          <form onSubmit={(e) => { e.preventDefault(); void send({ op: "answer", kind: at.step, value: code.trim() }); }}>
            <p className="fine">{at.step === "code" ? <>We sent a code to <b>{email}</b>.</> : "Enter the code from your authenticator app."}</p>
            {at.wrong && <p className="notice" role="alert">That code didn't match. Check it and try again.</p>}
            <label className="sr" htmlFor="code">Code</label>
            <input id="code" className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" required autoFocus placeholder="code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} />
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          </form>
        )}
        {at.step !== "email" && <p className="fine"><button className="linkish" onClick={restart}>Use a different email</button></p>}
        <p className="fine">Sign in with a code sent to your email, or a passkey. 1NEON uses only the cookies it needs to keep you signed in.</p>
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


/** One menu entry: its icon box and label line up with every other entry; picking it closes the full menu */
function Item({ to, icon, label, end }: { to: string; icon: ReactNode; label: string; end?: boolean }) {
  return (
    <li>
      <NavLink to={to} end={end} title={label}>
        {icon}
        <span className="lbl">{label}</span>
      </NavLink>
    </li>
  );
}


/** Menu, top bar, and content area shared by every signed-in page */
function Frame({ org, all, children }: { org?: OrgSummary; all?: boolean; children: ReactNode }) {
  const me = useSession();
  // The person's choice: a slim icon rail always on screen, or no rail and a menu button
  const rail = (me.user.menu ?? "rail") === "rail";
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState<ReactNode>(null);
  const loc = useLocation();
  // The full menu closes after navigating, and on Escape
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);
  const base = org ? `/o/${org.slug}` : "";
  return (
    <div className={`shell${rail ? " has-rail" : ""}`}>
      {/* Scrim behind the full menu; a tap outside closes it */}
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      {/* Menu: the onion opens and closes the full view; collapsed, only the icons show */}
      <aside className={`side${open ? " open" : ""}`} aria-label="Menu">
        <button className="brand" type="button" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Close the menu" : "Open the menu"}>
          <span className="ico mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="5"><circle cx="32" cy="32" r="28" /><circle cx="32" cy="32" r="19" /><circle cx="32" cy="32" r="10" /><circle cx="32" cy="32" r="2" /></svg>
          </span>
          <span className="lbl">1NEON</span>
        </button>
        {/* Organization: the full chooser when open, its initials when collapsed */}
        {open ? (
          <OrgChooser current={org} all={all} />
        ) : (
          <button className="org-mini" type="button" onClick={() => setOpen(true)} title={all ? "All clients" : org?.name ?? "Choose an organization"}>
            <span className="ico">{all ? "All" : org ? initials(org.name) : "?"}</span>
            <span className="lbl">{all ? "All clients" : org?.name ?? "Choose"}</span>
          </button>
        )}
        {/* Organization pages get the hubs and layers; All clients gets only its board */}
        <ul className="nav">
          {org ? (
            <>
              <Item to={`${base}/workspace`} icon={<Icon name="workspace" />} label="Workspace" />
              <Item to={`${base}/workflow`} icon={<Icon name="workflow" />} label="Workflow" />
              <li className="sep"><span className="lbl">Layers</span></li>
              {LAYERS.map((l) => (
                <Item key={l} to={`${base}/layer/${l}`} icon={<LayerBadge layer={l} />} label={layerName(l)} />
              ))}
              <li className="sep"><span className="lbl">Hubs</span></li>
              <Item to={`${base}/projects`} icon={<Icon name="projects" />} label="Projects" end={false} />
              <Item to={`${base}/people`} icon={<Icon name="people" />} label="People" />
              <Item to={`${base}/documents`} icon={<Icon name="documents" />} label="Documents" />
              <Item to={`${base}/settings`} icon={<Icon name="settings" />} label="Settings" />
            </>
          ) : all ? (
            <Item to="/all/workflow" icon={<Icon name="workflow" />} label="Workflow" />
          ) : null}
        </ul>
        {/* Back to the neon1.tech site, outside the app's routes, then the signed-in person */}
        <a className="site-link" href="/" title="neon1.tech">
          <Icon name="site" />
          <span className="lbl">neon1.tech</span>
        </a>
        <NavLink to="/me" className="who-link" title="Your profile">
          <span className="ico av-box"><Avatar id={me.user.id} name={me.user.name || me.user.email} size={24} /></span>
          <span className="lbl">{me.user.name || me.user.email}</span>
        </NavLink>
      </aside>
      <div className="main">
        {/* All clients is read only; say so on every screen of it */}
        {all && (
          <div className="readonly-bar" role="status">
            <strong>All clients · read only.</strong> Open a client to make changes.
          </div>
        )}
        {/* Top bar: the menu button when there's no rail, then whatever the page put in the crumb slot */}
        <header className="top">
          {!rail && <button className="chip" onClick={() => setOpen(!open)} aria-expanded={open}>menu</button>}
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
