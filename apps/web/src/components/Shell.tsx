// apps/web/src/components/Shell.tsx - App frame: sign-in gate, sidebar with the organization
// chooser, top bar, and the org context.


import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useParams } from "react-router";
import { menuOf } from "@1neon/domain";
import { api, DEMO as IN_DEMO, LIVE as IN_LIVE, devUser, HttpError, pickPerson, resetDemo, Unconfirmed } from "../lib/api.ts";
import { failureOf, read } from "../lib/reads.ts";
import { passkeyAssertion } from "../lib/passkey.ts";
import { SIGN_IN_METHODS } from "../lib/methods.ts";
import { REWIND } from "../lib/nav.ts";
import { usePersisting } from "../lib/persist.ts";
import { cleanCode, clearStep, loadStep, saveStep, session } from "../lib/signin.ts";
import type { Me, OrgResponse, OrgSummary } from "../lib/types.ts";
import { Bell } from "./Bell.tsx";
import { Offline } from "./Glitch.tsx";
import { Rain } from "./Rain.tsx";
import { FileText as FileIcon, Folder as FolderIcon, Home as HomeIcon, Kanban as KanbanIcon, Menu as MenuIcon, Search as SearchIcon } from "lucide-react";
import { ConfirmDialog } from "./Confirm.tsx";
import { HelpProvider, useHelp } from "./Help.tsx";
import { Neo } from "./Neo.tsx";
import { Palette } from "./Palette.tsx";
import { gate, Stale, type Read } from "./Reads.tsx";
import { Avatar, Icon, initials, LayerBadge, LAYERS, layerHint, layerName, layerSlug, Rings, useAsk } from "./ui.tsx";


// --- Session -----------------------------------------------------------------


/** The signed-in person and their organizations; a 401 here means "show sign-in" */
export function useMe() {
  // A dropped connection (common on phones waking up) is retried a few times; an HTTP answer is final
  return useQuery({ queryKey: ["me"], queryFn: () => read<Me>("/me", { user: "object", orgs: "array" }), retry: (n, e) => !(e instanceof HttpError) && n < 4, retryDelay: (n) => Math.min(800 * 2 ** n, 6000) });
}


// Session context for everything below Root
const MeCtx = createContext<Me | null>(null);
// Only valid inside Root, after sign-in
export const useSession = () => useContext(MeCtx)!;


/** Apply a theme to the page; with no attribute the styles show awake */
export function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
  syncDark();
}


// Whether the page shows Matrix (dark) right now: chosen outright, or "device" on a device set to dark.
// The html element carries it as the class n1-dark, so Neo's window can follow the same look as the
// landing page (dark over the rain, light over awake pages) and repaint the moment either one changes
const darkDevice = matchMedia("(prefers-color-scheme: dark)");
export function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "matrix" || (t === "device" && darkDevice.matches);
}
function syncDark() {
  document.documentElement.classList.toggle("n1-dark", isDark());
}
darkDevice.addEventListener?.("change", syncDark);


// Set by /arrive.js when someone came from neon1.tech's 1NEON link; the first sign-in screen uses it up
let arriving = document.documentElement.classList.contains("from-site");


/** Top-level gate: sign-in, error, first-visit redirect, then the app */
// Whether this browser was last signed in or out, for the background shown while the session loads
const LAST_KEY = "1neon.last";
const lastSeen = () => {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
};


export function Root() {
  // A walkthrough rewinding to a section's start remounts everything below, fresh
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const rewind = () => setEpoch((n) => n + 1);
    addEventListener(REWIND, rewind);
    return () => removeEventListener(REWIND, rewind);
  }, []);
  return <App key={epoch} />;
}


/** The app under Root: the session check, then sign-in or the signed-in pages */
function App() {
  const me = useMe();
  const loc = useLocation();
  const qc = useQueryClient();
  // Any call that hears 401 asks for a fresh session check; its 401 then shows sign-in below
  useEffect(() => {
    const check = () => void qc.invalidateQueries({ queryKey: ["me"] });
    addEventListener("1neon:signed-out", check);
    return () => removeEventListener("1neon:signed-out", check);
  }, [qc]);
  useEffect(() => {
    if (me.data) applyTheme(me.data.user.theme);
  }, [me.data]);
  // The black page from the site holds only until the first answer; the app then uses its own colors
  useEffect(() => {
    if (!me.isPending) document.documentElement.classList.remove("from-site");
  }, [me.isPending]);
  // Remember whether this browser was last signed in, so a reload starts on the right background
  useEffect(() => {
    const state = me.data ? "in" : me.error instanceof HttpError && me.error.status === 401 ? "out" : undefined;
    if (state) try { localStorage.setItem(LAST_KEY, state); } catch { /* storage blocked: the light loading line shows */ }
  }, [me.data, me.error]);
  if (me.isPending) {
    // Mid sign-in (iOS often reloads the tab after a trip to the mail app): go straight back to the
    // code step while the session check runs; it hands over if the person turns out signed in
    if (loadStep(session())) return <SignIn />;
    // Arriving from the site, or last seen signed out: wait on the dark sign-in background, not a white page
    if (arriving || lastSeen() === "out") return <div className="signin" aria-busy="true" />;
    return <div className="content muted" aria-busy="true">Loading…</div>;
  }
  // An ended sign-in always shows sign-in. Any other failure keeps an app already on screen (the frame
  // marks it as not refreshed); with nothing loaded yet it's the lost-signal screen, worded for a
  // server error when the API answered at all
  if (me.error && (me.data === undefined || failureOf(me.error) === "session")) {
    if (me.error instanceof HttpError && me.error.status === 401) return <SignIn />;
    return <Offline onRetry={me.refetch} server={me.error instanceof HttpError} />;
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


// The demo's people, each with what they can do; the buttons render in a dev build and in /1NEON/demo
const PEOPLE = [
  ["raj@acmedental.example", "Raj Patel", "Acme Dental's owner: approves options and manages people"],
  ["dana@acmedental.example", "Dana Kim", "Acme Dental's office manager: adds requests, answers, and files"],
  ["pradeep@neon1.tech", "Pradeep", "neon1's lead engineer: every client, proposals, and the work"],
] as const;
// The demo signs in by picking a person; the live playback always shows the real sign-in instead
// (email, then a code from her email), answered in the browser
const PICKER = IN_DEMO && !IN_LIVE;


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
    const start = window.setTimeout(() => show(4600), 900);
    return () => { clearTimeout(start); clearTimeout(timer.current); };
  }, []);
  return (
    <>
      <h1 className={`word${open ? " open" : ""}`} tabIndex={0} aria-label="1NEON" aria-describedby="word-meaning"
        // Hover is a mouse's only: a tap on a phone fires a hover that never ends, so it opens through the
        // click's timed spell-out instead. Focus opens it only from the keyboard, for the same reason
        onPointerEnter={(e) => e.pointerType === "mouse" && show()} onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()} onBlur={hide} onClick={() => show(4600)}>
        <span className="wm" aria-hidden="true">
          {/* The 1NEON mark beside the word, sized with it so it stays beside it when the word spells out */}
          <Rings />
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
  // ...including a link followed while this page is already open
  const { search } = useLocation();
  useEffect(() => {
    const e = new URLSearchParams(search).get("email");
    if (e) setEmail(e);
  }, [search]);
  const [code, setCode] = useState("");
  // Remember me: keep the sign-in for 30 days; unchecked, it ends when the browser closes
  const [remember, setRemember] = useState(true);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const [at, setAt] = useState<Step>(() => (saved ? { step: saved.step, methods: saved.methods } : { step: "email" }));
  const [busy, setBusy] = useState(false);
  // The last call got no answer, so it may or may not have gone through
  const [unsure, setUnsure] = useState(false);
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
    setUnsure(false);
    try {
      let r = await api<Step>("/auth/step", { method: "POST", body });
      if (r.step === "passkey") r = await api<Step>("/auth/step", { method: "POST", body: { op: "answer", kind: "passkey", value: await passkeyAssertion(r.options as never) } });
      setCode("");
      // Keep a step that waits on the person; finishing or failing forgets it
      if (r.step === "choose" || r.step === "code" || r.step === "totp") saveStep(session(), { email: email.trim(), step: r.step, methods: r.methods });
      else clearStep(session());
      if (r.step === "done") await qc.invalidateQueries();
      else setAt(r);
    } catch (e) {
      // No answer within the deadline: stay on this step with the email kept, and check the session
      // (a safe read), which hands over to the app if the sign-in did finish. Nothing is resent
      if (e instanceof Unconfirmed) {
        setUnsure(true);
        void api("/me").then(() => qc.invalidateQueries(), () => undefined);
      } else {
        clearStep(session());
        setAt({ step: "failed" });
      }
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
  // A fresh code was asked for, so the line above the box says so
  const [resent, setResent] = useState(false);
  // Start over with another email, forgetting the saved step
  const restart = () => { clearStep(session()); setAt({ step: "email" }); setCode(""); setResent(false); };
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
        {/* Who this is for, before anyone types: clients, by invitation */}
        {!PICKER && (
          <>
            <h2 className="signin-h">Client portal</h2>
            <p className="signin-lead">For neon1 clients. Access is by invitation.</p>
          </>
        )}
        {problem === "not_invited" && <p className="notice" role="alert">That email hasn't been invited yet. Ask your organization's admin, or neon1.</p>}
        {unsure && <p className="notice" role="alert">We couldn't confirm whether this finished. If a code arrives by email, you can still use it, or try again.</p>}
        {problem === "failed" && <p className="notice" role="alert">{fromLink ? "That link only works in the browser where you asked for the code. Type the code there instead, or start again here." : "Sign-in didn't finish. Please try again."}</p>}
        {/* The demo: no accounts, just pick who to be */}
        {PICKER && (
          <div className="dev demo-pick" aria-label="Demo people">
            <p className="fine">A working copy of 1NEON with made-up clients. Everything you do stays in this browser.</p>
            <TabOnly />
            <p className="eyebrow">Try it as</p>
            {PEOPLE.map(([e, name, role]) => (
              <button key={e} onClick={() => pick(e)}><b>{name}</b><span>{role}</span></button>
            ))}
            <p className="fine"><a href="/1NEON/live">Or watch the guided walkthrough</a></p>
          </div>
        )}
        {/* Step 1: the email */}
        {!PICKER && (at.step === "email" || at.step === "failed" || at.step === "not_invited") && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void send({ op: "start", email: email.trim(), remember }); }}>
            {/* A label that stays on screen, so it survives autofill and typed text (the placeholder doesn't) */}
            <label className="field-label" htmlFor="email">Email address</label>
            {/* Remember me opens under the email once it looks like a real address */}
            <div className={`email-row${emailOk ? " ok" : ""}`}>
              <input id="email" type="email" required autoComplete="email webauthn" placeholder="you@company.com" aria-describedby="email-next" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label className="remember" aria-hidden={!emailOk}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} tabIndex={emailOk ? 0 : -1} />
                remember me
              </label>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "One moment…" : "Continue"}</button>
            {/* What Continue leads to, worded the same whether or not the address has an account */}
            <p id="email-next" className="fine next-hint">{SIGN_IN_METHODS}</p>
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
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void send({ op: "answer", kind: at.step, value: code.trim() }); }}>
            <p className="fine" role="status">{at.step === "code" ? <>We sent {resent ? "a new code" : "a code"} to <b>{email}</b>.</> : "Enter the code from your authenticator app."}</p>
            {at.wrong && <p className="notice" role="alert">That code didn't match. Check it and try again.</p>}
            <label className="sr" htmlFor="code">Code</label>
            <input id="code" className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" required autoFocus placeholder="code" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} />
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
            {/* No email yet? Starting again with the same address sends a fresh code */}
            {at.step === "code" && <button className="linkish fine" type="button" disabled={busy} onClick={() => { setResent(true); void send({ op: "start", email: email.trim(), remember }); }}>Send a new code</button>}
          </form>
        )}
        {at.step !== "email" && <p className="fine"><button className="linkish" onClick={restart}>Use a different email</button></p>}
        {/* The three policies on one line of their own */}
        <p className="fine legal-links">
          <Link to="/faqs">FAQs</Link> · <Link to="/cookies">Cookies</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
        </p>
        {/* Not a client yet: the sample and the demo are one click away, with no sign-in to attempt.
            Kept out of the demo, which is already one of them */}
        {!IN_DEMO && (
          <nav className="signin-more" aria-label="Without an account">
            <a href="/1NEON/example">Read a sample project</a>
            <a href="/1NEON/demo/">Try the interactive demo</a>
          </nav>
        )}
        {/* Local builds also offer the demo people under the real form */}
        {pickPerson && !IN_DEMO && (
          <div className="dev" aria-label="Local demo accounts">
            <p className="fine" style={{ margin: "6px 0 0" }}>Local demo: sign in as</p>
            {PEOPLE.map(([e, name]) => (
              <button key={e} onClick={() => pick(e)}>{name}</button>
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
  const qc = useQueryClient();
  const { slug } = useParams();
  const summary = me.orgs.find((o) => o.slug === slug);
  const org = useQuery({ queryKey: ["org", summary?.id], queryFn: () => read<OrgResponse>(`/t/${summary!.id}`, { org: "object", access: "string" }), enabled: Boolean(summary) });
  // A 403 or 404 for an organization in my list means my access changed: refresh the list, which drops it
  const lost = org.isError && failureOf(org.error) === "unavailable";
  useEffect(() => {
    if (lost) void qc.invalidateQueries({ queryKey: ["me"] });
  }, [lost, qc]);
  // Not in my list, or no longer mine: the same "not here", without saying whether it exists
  if (!summary || lost) return <Frame><NotMember /></Frame>;
  // Still loading, or failed with nothing to show: say which, with Try again
  const wait = gate([org]);
  if (wait || !org.data) return <Frame org={summary}>{wait}</Frame>;
  const access = org.data.access;
  const value: OrgCtxValue = { ...org.data, summary, canWrite: access !== "viewer", canAdmin: access === "admin" };
  return (
    <OrgCtx.Provider value={value}>
      <Frame org={summary} reads={[org]}>
        <Outlet />
      </Frame>
    </OrgCtx.Provider>
  );
}


/** Pages outside any organization (the profile) still get the frame, search, and help */
export function PlainLayout() {
  return (
    <Frame>
      <Outlet />
    </Frame>
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
function Item({ to, icon, label, sub, end, tour }: { to: string; icon: ReactNode; label: string; sub?: string; end?: boolean; tour?: string }) {
  return (
    <li>
      <NavLink to={to} end={end} title={sub ? `${label}: ${sub}` : label} data-tour={tour}>
        {icon}
        {/* A layer's plain subtitle rides on the same row, so every row keeps its height */}
        <span className="lbl">{label}{sub && <small className="sub"><span className="sr">, </span>{sub}</small>}</span>
      </NavLink>
    </li>
  );
}


/** Menu, top bar, phone tab bar, and content area shared by every signed-in page. `reads` are the
 * layout's own queries, marked like the session when a refresh fails */
function Frame({ org, all, reads, children }: { org?: OrgSummary; all?: boolean; reads?: Read[]; children: ReactNode }) {
  const me = useSession();
  return (
    <HelpProvider me={me}>
      <FrameBody org={org} all={all} reads={reads}>{children}</FrameBody>
    </HelpProvider>
  );
}



/** Said in the demo once this browser refuses to save it: the demo still works, from memory */
function TabOnly() {
  const ok = usePersisting();
  if (ok) return null;
  return <span className="demo-tab-only" role="status">This demo lasts until you close or reload this tab.</span>;
}


/** The demo's strip above the portal: what this is, who you're being, and a way to start over */
function DemoBar() {
  const me = useSession();
  const qc = useQueryClient();
  // Back to the picker as someone else; the demo's data stays as it is
  const switchPerson = () => { devUser.set(""); void qc.invalidateQueries(); };
  // Start over forgets every change made on this device
  const ask = useAsk();
  const startOver = async () => { if (await ask({ title: "Start the demo over?", body: "Every change you made in this demo goes away.", yes: "Start over", danger: true })) void resetDemo(); };
  return (
    <div className="demo-bar" role="region" aria-label="Interactive demo">
      <span className="demo-tag">interactive demo</span>
      <span className="demo-note">You're {me.user.name || me.user.email}. Everything stays in this browser.</span>
      <TabOnly />
      <span className="demo-acts">
        <button className="linkish" onClick={switchPerson}>Switch person</button>
        <button className="linkish" onClick={startOver}>Start over</button>
      </span>
    </div>
  );
}

// The organization last in view, for the menu on pages outside one: the remembered one if it's still
// theirs, else their only one; someone in several with nothing remembered picks from the chooser
const LAST_ORG = "1neon.lastOrg";
function lastOrg(orgs: OrgSummary[]) {
  let slug: string | null = null;
  try { slug = localStorage.getItem(LAST_ORG); } catch { /* storage blocked */ }
  return orgs.find((o) => o.slug === slug) ?? (orgs.length === 1 ? orgs[0] : undefined);
}
// What can take focus inside the menu, for moving focus into it when it opens
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])";


// The frame itself, inside the help context so the ? button and search can use it
function FrameBody({ org, all, reads = [], children }: { org?: OrgSummary; all?: boolean; reads?: Read[]; children: ReactNode }) {
  const me = useSession();
  // The session query itself, for marking the frame when a background check of it fails
  const meRead = useMe();
  const help = useHelp();
  // The person's choice: default opens the full menu from a button; mini also keeps the icon rail
  // on screen at every size. Either way the full menu opens over the page from the menu buttons
  const mini = menuOf(me.user.menu) === "mini";
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const [top, setTop] = useState<ReactNode>(null);
  const loc = useLocation();
  // Each page (a project counts as one, whatever its tab) eases in when you arrive
  const parts = loc.pathname.split("/");
  const section = parts.slice(0, parts[3] === "projects" && parts[4] && parts[4] !== "new" ? 5 : 4).join("/");
  // The full menu closes after navigating, and on Escape
  useEffect(() => setOpen(false), [loc.pathname]);
  // Arriving on another page puts keyboard focus on its title, so a screen reader hears where it is and
  // the next Tab starts in the page. Only when focus would otherwise be lost (on the body, gone, or in the
  // menu that navigated); a link to a spot on the page (#item-...) and background refreshes keep theirs (AP-05)
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) { firstSection.current = false; return; }
    if (loc.hash) return;
    const t = window.setTimeout(() => {
      const at = document.activeElement;
      const lost = !at || at === document.body || !at.isConnected || Boolean(side.current?.contains(at)) || Boolean(at.closest(".tabbar"));
      const title = document.querySelector<HTMLElement>("#main h1, #main .page-title");
      if (!lost || !title) return;
      if (!title.hasAttribute("tabindex")) title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);
  // Offscreen means out of the focus order: the menu is inert while it's tucked away behind the menu
  // buttons, and while it's open as an overlay the page behind it is inert instead
  const tucked = !open && !mini;
  const side = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // Opening moves focus into the menu (to the page in view, or its first control) unless it's already
  // there; closing puts focus back on whatever opened it, if focus would otherwise be lost
  useEffect(() => {
    const el = side.current;
    if (!el) return;
    if (open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // The menu always opens at its top, row for row beside the rail; focusing the page in view must
      // not scroll it (on the profile, that link sits at the very bottom)
      el.scrollTop = 0;
      if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>("a[aria-current='page']") ?? el.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
      return;
    }
    const back = trigger.current;
    trigger.current = null;
    const lost = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
    if (back?.isConnected && !back.closest("[inert]") && lost) back.focus();
  }, [open]);
  // Remember the organization in view, so pages outside one (profile, FAQs) keep its menu and tabs
  useEffect(() => { if (org) try { localStorage.setItem(LAST_ORG, org.slug); } catch { /* storage blocked: falls back below */ } }, [org]);
  const navOrg = org ?? (all ? undefined : lastOrg(me.orgs));
  const base = navOrg ? `/o/${navOrg.slug}` : "";
  // Home: the organization's Home, All clients' board for an operator there, or the app's landing
  const home = navOrg ? `${base}/workspace` : all ? "/all/workflow" : "/";
  return (
    <div className={`shell${mini ? " mini" : ""}`}>
      {/* First stop for the keyboard: straight to the page, past the menu and top bar. Focus moves in
          code, so the address never gains a #main that pages would read as a link to an item */}
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      {IN_DEMO && !IN_LIVE && <DemoBar />}
      {/* Scrim behind the full menu; a tap outside closes it */}
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside ref={side} className={`side${open ? " open" : ""}`} aria-label="Menu" inert={tucked}>
        {/* The mark and name lead Home, from the open menu and the Mini rail alike. It sits exactly where
            the top bar's own mark sits, so opening the menu covers one with the other */}
        <Link className="brand" to={home} onClick={() => setOpen(false)} title="Home" aria-label="1NEON, Home">
          <span className="ico mark" aria-hidden="true">
            <Rings />
          </span>
          <span className="lbl">1NEON</span>
        </Link>
        {/* Organization: the full chooser when there's room for labels, its initials otherwise */}
        <div className="org-full"><OrgChooser current={org} all={all} /></div>
        <button className="org-mini" type="button" onClick={() => setOpen(true)} title={all ? "All clients" : navOrg?.name ?? "Choose an organization"}>
          <span className="ico">{all ? "All" : navOrg ? initials(navOrg.name) : "?"}</span>
          <span className="lbl">{all ? "All clients" : navOrg?.name ?? "Organizations"}</span>
        </button>
        {/* Organization pages get the main places and the four layers; All clients gets only its board */}
        <ul className="nav">
          {navOrg ? (
            <>
              <Item to={`${base}/workspace`} icon={<Icon name="workspace" />} label="Home" tour="nav-home" />
              <Item to={`${base}/workflow`} icon={<Icon name="workflow" />} label="Board" tour="nav-board" />
              <Item to={`${base}/projects`} icon={<Icon name="projects" />} label="Projects" end={false} tour="nav-projects" />
              <Item to={`${base}/documents`} icon={<Icon name="documents" />} label="Files" tour="nav-files" />
              <Item to={`${base}/insights`} icon={<Icon name="insights" />} label="Insights" tour="nav-insights" />
              <li className="sep" data-tour="nav-layers"><span className="lbl">Layers</span>
                <ul className="nav">
                  {LAYERS.map((l) => (
                    <Item key={l} to={`${base}/layer/${layerSlug(l)}`} icon={<LayerBadge layer={l} />} label={layerName(l)} sub={layerHint(l)} />
                  ))}
                </ul>
              </li>
              <li className="sep"><span className="lbl">Organization</span></li>
              <Item to={`${base}/people`} icon={<Icon name="people" />} label="People" />
              <Item to={`${base}/settings`} icon={<Icon name="settings" />} label="Settings" />
            </>
          ) : all ? (
            <Item to="/all/workflow" icon={<Icon name="workflow" />} label="Board" />
          ) : null}
        </ul>
        {/* Back to the neon1.tech site, outside the app's routes, then the signed-in person */}
        <a className="site-link" href="/" title="neon1.tech">
          <Icon name="site" />
          <span className="lbl">neon1.tech</span>
        </a>
        <NavLink to="/me" className="who-link" title="Your profile" data-tour="nav-me">
          <span className="ico av-box"><Avatar id={me.user.id} name={me.user.name || me.user.email} size={24} /></span>
          <span className="lbl">{me.user.name || me.user.email}</span>
        </NavLink>
      </aside>
      <div className="main" inert={open}>
        {/* All clients is read only; say so on every screen of it */}
        {all && (
          <div className="readonly-bar" role="status">
            <strong>All clients · read only.</strong> Open a client to make changes.
          </div>
        )}
        {/* Top bar: the menu button (always: it costs no room), the page's crumbs, then search and help */}
        <header className="top">
          {/* The mark and name, Home's way in, before the menu button; in Mini the rail shows the mark instead */}
          {!mini && <Link className="top-brand" to={home} title="Home" aria-label="1NEON, Home"><span className="mark-box" aria-hidden="true"><Rings /></span><span className="lbl">1NEON</span></Link>}
          <button className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu" title="Menu" data-tour="menu"><MenuIcon size={18} /></button>
          <div className="crumb">{top}</div>
          <span className="spacer" />
          <button className="search-btn" onClick={() => setSearch(true)} data-tour="search" aria-label="Search">
            <SearchIcon size={16} aria-hidden="true" />
            <span className="hide-sm">Search</span>
            <span className="kbd hide-sm">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</span>
          </button>
          {org && <Bell tid={org.id} slug={org.slug} />}
          <button className="icon-btn help-btn" onClick={help.open} data-tour="help" aria-label="Help for this page" title="Help for this page">?</button>
        </header>
        <Crumbs.Provider value={setTop}>
          <main className="content" id="main" tabIndex={-1}>
            <Stale reads={[meRead, ...reads]} />
            <div className="page-in" key={section}>{children}</div>
          </main>
        </Crumbs.Provider>
      </div>
      {/* Phones: the main places as a tab bar at the bottom, within thumb reach */}
      <nav className="tabbar" aria-label="Main" inert={open}>
        {navOrg ? (
          <>
            <NavLink to={`${base}/workspace`} data-tour="nav-home"><HomeIcon size={20} aria-hidden="true" /><span>Home</span></NavLink>
            <NavLink to={`${base}/workflow`} data-tour="nav-board"><KanbanIcon size={20} aria-hidden="true" /><span>Board</span></NavLink>
            <NavLink to={`${base}/projects`} data-tour="nav-projects"><FolderIcon size={20} aria-hidden="true" /><span>Projects</span></NavLink>
            <NavLink to={`${base}/documents`} data-tour="nav-files"><FileIcon size={20} aria-hidden="true" /><span>Files</span></NavLink>
          </>
        ) : (
          <NavLink to="/"><HomeIcon size={20} aria-hidden="true" /><span>Home</span></NavLink>
        )}
        <button type="button" className="menu-btn" onClick={() => setOpen(!open)} aria-expanded={open}><MenuIcon size={20} aria-hidden="true" /><span>Menu</span></button>
      </nav>
      <Palette me={me} org={org} open={search} setOpen={setSearch} onHelp={help.open} onTour={help.welcomeTour} />
      <ConfirmDialog me={me} />
      {/* Neo for signed-in people, where a model is wired; elsewhere the public Neo stays */}
      {me.neo && !IN_DEMO && <Neo />}
    </div>
  );
}


/** The organization switcher at the top of the sidebar: a button that shows a short list of links.
 * Tab and Enter work as everywhere; arrow keys move through the list, Escape closes it and returns
 * focus to the button, and focus leaving the chooser closes it */
function OrgChooser({ current, all }: { current?: OrgSummary; all?: boolean }) {
  const me = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // Close the menu on any click outside it
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, []);
  // Opening puts focus on the search box, or the current organization, or the first entry
  useEffect(() => {
    if (!open) return;
    const list = ref.current?.querySelector(".menu");
    (list?.querySelector<HTMLElement>("input") ?? list?.querySelector<HTMLElement>("[aria-current='true']") ?? list?.querySelector<HTMLElement>("a"))?.focus();
  }, [open]);
  // Arrow keys step through the entries; Escape closes without leaving the frame's menu
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      toggle.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(".menu a") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  // People in one organization see its name, not a chooser
  const many = me.operator || me.orgs.length > 1;
  // Outside an organization (profile, FAQs): one organization reads as a way back to it; several, as a choice
  const only = !many ? me.orgs[0] : undefined;
  const label = all ? "All clients" : current?.name ?? only?.name ?? "Choose an organization";
  const sub = all ? "read only" : current?.clientId ?? (only ? "back to Home" : "");
  const list = me.orgs.filter((o) => (o.name + o.clientId).toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} style={{ position: "relative" }} onKeyDown={keys} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget && setOpen(false)}>
      {!current && !all && only ? (
        <Link className="org" to={`/o/${only.slug}/workspace`}><b>{label}</b><small>{sub}</small></Link>
      ) : (
        <button ref={toggle} className={`org${all ? " all" : ""}`} onClick={() => many && setOpen(!open)} aria-expanded={many ? open : undefined} aria-controls={many ? "org-list" : undefined} disabled={!many && !current}>
          <b>{label}{many && <span aria-hidden="true">▾</span>}</b>
          <small>{sub}</small>
        </button>
      )}
      {open && (
        <div className="menu" id="org-list" style={{ top: "calc(100% + 6px)", left: 0, right: 0 }}>
          {me.orgs.length > 6 && <input aria-label="Search organizations" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />}
          {/* The operator can always jump to All clients */}
          {me.operator && (
            <>
              <Link to="/all/workflow" aria-current={all ? "true" : undefined} onClick={() => setOpen(false)}>
                All clients <small>read only</small>
              </Link>
              <hr />
            </>
          )}
          {list.map((o) => (
            <Link key={o.id} to={`/o/${o.slug}/workspace`} aria-current={o.id === current?.id ? "true" : undefined} onClick={() => setOpen(false)}>
              {o.name} <small>{o.clientId}</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
