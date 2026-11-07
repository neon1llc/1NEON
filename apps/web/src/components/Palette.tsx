// apps/web/src/components/Palette.tsx - Search and commands: one box to jump to any page or project
// and start common actions. Opens with Ctrl K or ⌘K, "/", or the search button. Built on cmdk (MIT).


import type { Project } from "@1neon/domain";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import type { Me, OrgSummary } from "../lib/types.ts";
import { Dialog } from "./ui.tsx";


/** The palette for one organization (or none, on profile and All clients) */
export function Palette({ me, org, open, setOpen, onHelp, onTour }: { me: Me; org?: OrgSummary; open: boolean; setOpen: (v: boolean) => void; onHelp: () => void; onTour: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  // Projects to jump to; fetched only while the palette is open
  const projects = useQuery({ queryKey: ["projects", org?.id], queryFn: () => api<Project[]>(`/t/${org!.id}/projects`), enabled: open && Boolean(org) });

  // Ctrl K / ⌘K anywhere, and "/" when not typing in a field
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [setOpen]);

  // Every choice closes the palette first
  const go = (fn: () => void) => () => {
    setOpen(false);
    setQ("");
    fn();
  };
  const base = org ? `/o/${org.slug}` : "";
  return (
    <Dialog open={open} onClose={() => setOpen(false)} label="Search" className="palette">
      <Command label="Search 1NEON" loop>
        <Command.Input value={q} onValueChange={setQ} placeholder="Search pages and projects, or type a command" autoFocus />
        <Command.List>
          <Command.Empty>Nothing matches. Try another word.</Command.Empty>
          {org && (
            <Command.Group heading="Do">
              <Command.Item onSelect={go(() => nav(`${base}/projects/new`))}>Start a new project</Command.Item>
              <Command.Item onSelect={go(() => nav(`${base}/people`))}>Invite people</Command.Item>
              <Command.Item onSelect={go(() => nav(`${base}/documents`))}>Upload a file</Command.Item>
            </Command.Group>
          )}
          {org && (projects.data?.length ?? 0) > 0 && (
            <Command.Group heading="Projects">
              {projects.data!.filter((p) => !p.archived).map((p) => (
                <Command.Item key={p.id} value={`${p.key} ${p.name}`} onSelect={go(() => nav(`${base}/projects/${p.key}`))}>
                  <span className="mono small muted">{p.key}</span> {p.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Go to">
            {org && (
              <>
                <Command.Item onSelect={go(() => nav(`${base}/workspace`))}>Home</Command.Item>
                <Command.Item onSelect={go(() => nav(`${base}/workflow`))}>Board</Command.Item>
                <Command.Item onSelect={go(() => nav(`${base}/projects`))}>Projects</Command.Item>
                <Command.Item onSelect={go(() => nav(`${base}/documents`))}>Files</Command.Item>
                <Command.Item onSelect={go(() => nav(`${base}/insights`))}>Insights</Command.Item>
                <Command.Item onSelect={go(() => nav(`${base}/people`))}>People</Command.Item>
                <Command.Item onSelect={go(() => nav(`${base}/settings`))}>Settings</Command.Item>
              </>
            )}
            <Command.Item onSelect={go(() => nav("/me"))}>Your profile</Command.Item>
            {me.operator && <Command.Item onSelect={go(() => nav("/all/workflow"))}>All clients</Command.Item>}
            {me.orgs.filter((o) => o.id !== org?.id).map((o) => (
              <Command.Item key={o.id} value={`switch ${o.name} ${o.clientId}`} onSelect={go(() => nav(`/o/${o.slug}/workspace`))}>Switch to {o.name}</Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Help">
            <Command.Item onSelect={go(onHelp)}>Help for this page</Command.Item>
            <Command.Item onSelect={go(onTour)}>Take the tour</Command.Item>
            <Command.Item onSelect={go(() => nav("/faqs"))}>FAQs</Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </Dialog>
  );
}
