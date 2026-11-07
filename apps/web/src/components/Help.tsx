// apps/web/src/components/Help.tsx - Guidance: the welcome tour on first sign-in, the "?" help
// sheet on every page, and the short spotlight tours both start. Tours use driver.js (MIT).


import type { User } from "@1neon/domain";
import { useQueryClient } from "@tanstack/react-query";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../lib/api.ts";
import type { Me } from "../lib/types.ts";
import { Dialog } from "./ui.tsx";


// --- What each page is for --------------------------------------------------------


/** One step of a spotlight tour: the element it points at (by data-tour name) and two short lines */
export interface Step {
  at: string;
  title: string;
  text: string;
}


/** A page's guidance: what it's for in one line, a few how-tos, and its spotlight tour */
interface Guide {
  title: string;
  purpose: string;
  howto: string[];
  tour: Step[];
}


// The pages that have guidance; every signed-in route maps to one
export type PageKey = "home" | "board" | "projects" | "project" | "newproject" | "layer" | "people" | "files" | "insights" | "settings" | "me" | "all";


// Plain words, one idea per line. The tours point at data-tour names that pages put on their elements
export const GUIDES: Record<PageKey, Guide> = {
  home: {
    title: "Home",
    purpose: "Your starting point: what needs you, and what changed lately.",
    howto: ["Work through Needs you, top to bottom.", "Coming up shows what's due in the next three weeks.", "Insights in the menu has charts of how work is going."],
    tour: [
      { at: "needs-you", title: "Needs you", text: "Things waiting on you: approvals, tasks, and files to send. Open one to act on it." },
      { at: "coming-up", title: "Coming up", text: "The next three weeks at a glance: due dates, milestones, and targets. Overdue things are flagged." },
      { at: "get-started", title: "Get started", text: "A short setup checklist. It disappears once everything is done." },
      { at: "activity", title: "Recent activity", text: "What people did lately, newest first." },
    ],
  },
  board: {
    title: "Board",
    purpose: "Every project as a card, in the stage it's in right now.",
    howto: ["Drag a card to move it to another stage.", "On a phone, use the card's Move button.", "Each column says what has to be true to move on."],
    tour: [
      { at: "board-column", title: "Stages", text: "Columns run left to right, from the first call to care after handover." },
      { at: "board-card", title: "Projects", text: "Drag a card to the next stage, or open it to see the work." },
    ],
  },
  projects: {
    title: "Projects",
    purpose: "All projects in one list.",
    howto: ["Switch between List and Timeline at the top.", "Filter by layer, or sort by stage, target date, or recent changes.", "Start one with New project."],
    tour: [
      { at: "new-project", title: "New project", text: "Answer a few questions and the project starts with the right checklist." },
      { at: "project-list", title: "Your projects", text: "Each row shows the stage, health, and target date." },
    ],
  },
  project: {
    title: "Project",
    purpose: "One project: what's next, and its work in four layers.",
    howto: ["Start with Next step: it says what to do now.", "Tap any item to open it: change its status, owner, or due date, and comment.", "The onion beside the name fills as each layer's work gets done.", "Post an update to say how it's going."],
    tour: [
      { at: "next-step", title: "Next step", text: "What has to happen now, and who it's waiting on." },
      { at: "stage", title: "Stage", text: "Where the project is. It moves on when this stage's work is done." },
      { at: "layers", title: "The four layers", text: "Needs: what's wanted. Execute: the work. Observe: the results. Normalize: making it last." },
    ],
  },
  newproject: {
    title: "New project",
    purpose: "Start a project by answering a few short questions.",
    howto: ["Pick the kind of project that fits best.", "Name it in plain words.", "Add how you'll measure success, if you know."],
    tour: [{ at: "wizard", title: "A few questions", text: "Go step by step. You can change everything later." }],
  },
  layer: {
    title: "Layer",
    purpose: "One layer of the work, across every project.",
    howto: ["Open a project to add or change its items."],
    tour: [{ at: "layer-list", title: "Across projects", text: "Every project's items for this layer, in one place." }],
  },
  people: {
    title: "People",
    purpose: "Who's in this organization, and what each person can do.",
    howto: ["Invite people by email.", "Viewers read and comment. Editors also change work. Admins also manage people and settings."],
    tour: [
      { at: "invite", title: "Invite people", text: "Type their email. They get a link and sign in with a code." },
      { at: "people-list", title: "Access", text: "Change what someone can do, or deactivate them." },
    ],
  },
  files: {
    title: "Files",
    purpose: "Every file shared in this organization.",
    howto: ["Upload a file and pick its project.", "Files are checked for viruses before anyone can download them."],
    tour: [{ at: "upload", title: "Upload", text: "Drop a file here, or choose one." }],
  },
  insights: {
    title: "Insights",
    purpose: "How work is going, in charts made from your own data.",
    howto: ["The numbers on top update as work gets done.", "Finished per week shows the pace; Activity shows busy days.", "Projects by layer shows where things sit across N E O N."],
    tour: [
      { at: "kpis", title: "At a glance", text: "Open work, on-time rate, days to a decision, and measures at target." },
      { at: "weekly", title: "Pace", text: "Items finished each week for the last eight weeks." },
      { at: "activity-map", title: "Activity", text: "One square a day. Darker means busier." },
      { at: "by-layer", title: "Across the layers", text: "Where projects sit: Needs, Execute, Observe, or Normalize." },
    ],
  },
  settings: {
    title: "Settings",
    purpose: "How this organization works: the stages on the board.",
    howto: ["Rename a stage or say when it's done.", "Hide stages you don't use.", "Saving asks you to confirm it's you."],
    tour: [{ at: "stages", title: "Stages", text: "Each row is a column on the board, in order." }],
  },
  me: {
    title: "Your profile",
    purpose: "Your name, look, passkey, and the tutorial.",
    howto: ["Add a passkey or an authenticator app, so you can confirm it's you for admin actions.", "Replay the tutorial whenever you like."],
    tour: [{ at: "passkey", title: "Sign-in security", text: "Add a passkey or an authenticator app. Admins need one to manage people and settings." }],
  },
  all: {
    title: "All clients",
    purpose: "Every client's projects on one read-only board.",
    howto: ["Open a client to make changes."],
    tour: [{ at: "board-column", title: "Read only", text: "Look across clients here. Changes happen inside each client." }],
  },
};


/** The guide for the page at this path */
export function pageKey(path: string): PageKey {
  if (path.startsWith("/all")) return "all";
  if (path.startsWith("/me")) return "me";
  if (/\/projects\/new$/.test(path)) return "newproject";
  if (/\/projects\/[^/]+/.test(path)) return "project";
  if (path.endsWith("/projects")) return "projects";
  if (path.includes("/workflow")) return "board";
  if (path.includes("/layer/")) return "layer";
  if (path.endsWith("/people")) return "people";
  if (path.endsWith("/documents")) return "files";
  if (path.endsWith("/insights")) return "insights";
  if (path.endsWith("/settings")) return "settings";
  return "home";
}


// --- Spotlight tours ---------------------------------------------------------------


/** Only steps whose element is on screen right now; phones and desktops show different elements */
function visible(steps: Step[]): DriveStep[] {
  return steps.flatMap((s) => {
    // On screen means laid out and inside the viewport; the phone menu slides its items off to the left
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${s.at}"]`)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
    });
    return el ? [{ element: el, popover: { title: s.title, description: s.text } }] : [];
  });
}


/** Run a spotlight tour: everything else is shaded, one short popover at a time */
export function runTour(steps: Step[], onDone?: () => void) {
  const list = visible(steps);
  if (!list.length) {
    onDone?.();
    return;
  }
  const d = driver({
    steps: list,
    showProgress: list.length > 1,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    popoverClass: "n1-tour",
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 10,
    smoothScroll: true,
    onDestroyed: () => onDone?.(),
  });
  d.drive();
}


// The welcome tour: the frame first (menu, search, help), then this page's own steps, then where to replay it
const FRAME: Step[] = [
  { at: "nav-home", title: "Home", text: "Start here. It shows what needs you." },
  { at: "nav-board", title: "Board", text: "Every project, in the stage it's in." },
  { at: "nav-projects", title: "Projects and files", text: "Each project keeps its needs, work, results, and files together." },
  { at: "nav-layers", title: "N E O N", text: "Needs, Execute, Observe, Normalize: the four layers every project moves through." },
  { at: "search", title: "Search", text: "Jump to any page or project, or start something new." },
  { at: "help", title: "Help", text: "Stuck? Tap ? on any page for a short guide to that page." },
];
const LAST: Step = { at: "help", title: "You're set", text: "Replay this tour anytime from ? or from your profile." };


// --- Help sheet, welcome dialog, and the context that opens them ------------------


// Opens the help sheet and starts the welcome tour from anywhere in the frame
const HelpCtx = createContext<{ open: () => void; welcomeTour: () => void }>({ open: () => undefined, welcomeTour: () => undefined });
export const useHelp = () => useContext(HelpCtx);


/** Provides the "?" sheet and the welcome tour, and offers the tour once per sign-in until it's done */
export function HelpProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const [sheet, setSheet] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const key = pageKey(loc.pathname);

  // The person's tour choice is kept with their account, so it follows them to every device
  const [name, setName] = useState("");
  const saveTour = useCallback(async (tour: NonNullable<User["tour"]>) => {
    const cur = qc.getQueryData<Me>(["me"]) ?? me;
    // A name typed in the welcome dialog is saved with the choice, so people show by name to others
    const named = !cur.user.name && name.trim() ? { name: name.trim() } : {};
    try {
      const user = await api<User>("/me", { method: "PATCH", body: { version: cur.user.version, tour, ...named } });
      qc.setQueryData(["me"], { ...cur, user });
    } catch {
      // Not saved: the offer simply comes back next time
    }
  }, [me, qc, name]);

  // The whole tour; finishing or closing it counts as done, since ? brings it back
  const welcomeTour = useCallback(() => {
    setSheet(false);
    setWelcome(false);
    setTimeout(() => runTour([...FRAME, ...GUIDES[key].tour, LAST], () => void saveTour("done")), 250);
  }, [key, saveTour]);

  // Offer the tour once per browser session while it's new or postponed
  useEffect(() => {
    if (me.user.tour === "done") return;
    try {
      if (sessionStorage.getItem("1neon.tour-offered")) return;
    } catch {
      // No storage: offer it anyway
    }
    // The flag is set when the offer shows, so a remount before then doesn't swallow it
    const t = setTimeout(() => {
      try { sessionStorage.setItem("1neon.tour-offered", "1"); } catch { /* no storage */ }
      setWelcome(true);
    }, 700);
    return () => clearTimeout(t);
  }, [me.user.tour]);

  const value = useMemo(() => ({ open: () => setSheet(true), welcomeTour }), [welcomeTour]);
  const g = GUIDES[key];
  return (
    <HelpCtx.Provider value={value}>
      {children}
      {/* The help sheet: what this page is for, a few how-tos, and its tour */}
      <Dialog open={sheet} onClose={() => setSheet(false)} label={`Help: ${g.title}`} className="sheet">
        <p className="eyebrow">Help · {g.title}</p>
        <h2>{g.purpose}</h2>
        <ul className="howto">{g.howto.map((h) => <li key={h}>{h}</li>)}</ul>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => { setSheet(false); setTimeout(() => runTour(g.tour), 250); }}>Show me on this page</button>
          <button className="btn btn-ghost" onClick={welcomeTour}>Full tour</button>
        </div>
        <p className="small muted">More answers in the <Link to="/faqs" onClick={() => setSheet(false)}>FAQs</Link>.</p>
      </Dialog>
      {/* First sign-in: offer the tour, with remind-me and skip */}
      <Dialog open={welcome} onClose={() => setWelcome(false)} label="Welcome to 1NEON">
        <p className="eyebrow">Welcome to 1NEON</p>
        <h2>New here? Take the 1-minute tour.</h2>
        <p className="muted">It shows where things are and what to do first.</p>
        {!me.user.name && (
          <div style={{ margin: "12px 0" }}>
            <label htmlFor="welcome-name">Your name, so others know who you are</label>
            <input id="welcome-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder="First and last name" />
          </div>
        )}
        <div className="actions stack-sm">
          <button className="btn btn-primary" onClick={welcomeTour}>Start the tour</button>
          <button className="btn btn-ghost" onClick={() => { setWelcome(false); void saveTour("later"); }}>Remind me next time</button>
          <button className="btn btn-ghost" onClick={() => { setWelcome(false); void saveTour("done"); }}>Skip</button>
        </div>
        <p className="small muted">You can replay it anytime from <b>?</b> at the top right, or from your profile.</p>
      </Dialog>
    </HelpCtx.Provider>
  );
}
