// apps/web/src/pages/People.tsx - People: who belongs to the organization, their access, and
// invitations.


import type { AccessLevel } from "@1neon/domain";
import { useState } from "react";
import { gate, Stale } from "../components/Reads.tsx";
import { useOrg, useSession, useTopBar } from "../components/Shell.tsx";
import { ago, Avatar, useToast } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { problem, useMembers, useRefresh } from "../lib/hooks.ts";
import type { MemberRow } from "../lib/types.ts";


// Plain descriptions of each access level, used in the invite form and the legend
const ACCESS: Record<AccessLevel, string> = {
  viewer: "Viewer: reads and comments, and approves when named decision maker",
  editor: "Editor: also adds and changes work",
  admin: "Admin: also manages people and settings",
};


// How an invited person's email is doing, in plain words
const INVITE_STATE = { queued: "email on its way", sent: "email sent", failed: "email didn't go out" } as const;


// The member table for everyone; invites and access changes for admins
export function People() {
  const { org, canAdmin } = useOrg();
  const me = useSession();
  const members = useMembers(org.id);
  const refresh = useRefresh(org.id);
  const toast = useToast();
  useTopBar(<span>{org.name} · People</span>, [org.name]);

  // Change one member's access or status; the API keeps at least one admin
  const change = async (m: MemberRow, patch: Record<string, unknown>) => {
    try {
      await api(`/t/${org.id}/members/${m.userId}`, { method: "PATCH", body: { version: m.version, ...patch } });
      toast("Saved");
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };

  // Send someone's invitation again; the API limits how often, and the row shows how it went
  const resend = async (m: MemberRow) => {
    try {
      const r = await api<MemberRow>(`/t/${org.id}/members/${m.userId}/resend`, { method: "POST" });
      toast(r.invite?.state === "sent" ? `Invitation sent again to ${m.email}` : `Invitation queued for ${m.email}`);
    } catch (e) {
      toast(problem(e));
    }
    refresh();
  };

  // Active people first, alphabetically; deactivated people at the end
  const list = (members.data ?? []).slice().sort((a, b) => Number(a.status === "deactivated") - Number(b.status === "deactivated") || (a.name || a.email).localeCompare(b.name || b.email));
  return (
    <>
      <h1 className="page-title">People</h1>
      <p className="lead">Everyone here sees the same projects. Access sets what they can change.</p>
      {canAdmin && <Invite />}
      <Stale reads={[members]} />
      {/* Until the list answers, no empty table */}
      {gate([members]) ?? <div style={{ overflowX: "auto" }}>
        {/* One row per member: who, email, access, and status with its action */}
        <table className="people" data-tour="people-list">
          <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((m) => {
              // Admins change others' access; nobody changes their own here, and neon1's access is neon1's to change
              const editable = canAdmin && m.userId !== me.user.id && (!m.neon1 || me.operator);
              return (
              <tr key={m.userId} style={m.status === "deactivated" ? { opacity: 0.55 } : undefined}>
                <td><span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><Avatar id={m.userId} name={m.name || m.email} /><span>{m.name || <span className="muted">{m.status === "invited" ? "Name comes when they join" : "No name yet"}</span>}<br /><span className="muted small">{m.title}</span></span></span></td>
                <td className="mono small">{m.email}{m.neon1 && <span className="tag client" style={{ marginLeft: 8 }} title="neon1's access is managed by neon1">neon1</span>}</td>
                <td>
                  {editable && m.status !== "deactivated" ? (
                    <select aria-label={`Access for ${m.email}`} value={m.access} onChange={(e) => void change(m, { access: e.target.value })} style={{ minHeight: 32, paddingTop: 2, paddingBottom: 2, paddingLeft: 8, maxWidth: 140 }}>
                      <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
                    </select>
                  ) : <span className="tag">{m.access}</span>}
                </td>
                <td className="small">
                  {m.status === "invited" ? <span className="tag warn">invited {ago(m.invitedAt)}</span> : m.status === "deactivated" ? "deactivated" : <span className="muted">seen {ago(m.lastSeenAt)}</span>}
                  {/* Whether the invitation email actually went out, and a way to send it again */}
                  {m.status === "invited" && m.invite && <span className={`muted small invite-${m.invite.state}`} style={{ marginLeft: 8 }}>{INVITE_STATE[m.invite.state]}</span>}
                  {canAdmin && m.status === "invited" && <button className="linkish small" style={{ marginLeft: 10 }} onClick={() => void resend(m)}>Resend</button>}
                  {/* Deactivate keeps the person's history; reactivate restores their access */}
                  {editable && (
                    <button className="linkish small" style={{ marginLeft: 10 }} onClick={() => void change(m, { status: m.status === "deactivated" ? "joined" : "deactivated" })}>
                      {m.status === "deactivated" ? "Reactivate" : "Deactivate"}
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
      {/* Legend for the access levels */}
      <h2 className="section-h">What each access level can do</h2>
      <ul className="small muted">{Object.values(ACCESS).map((a) => <li key={a}>{a}</li>)}</ul>
    </>
  );
}


/** Admins invite one or more people by email with one access level */
function Invite() {
  const { org } = useOrg();
  const refresh = useRefresh(org.id);
  const toast = useToast();
  // Collapsed to a button until an admin starts an invite
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [access, setAccess] = useState<AccessLevel>("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn btn-primary" data-tour="invite" style={{ marginBottom: 18 }} onClick={() => setOpen(true)}>Invite people</button>;
  // Accept commas, semicolons, spaces, or new lines between addresses
  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  // One request for every address; the API emails each person
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // Say what actually happened: sent now, or queued to retry (People shows when it goes out)
      const out = await api<MemberRow[]>(`/t/${org.id}/members/invite`, { method: "POST", body: { people: list.map((email) => ({ email, access })) } });
      const sent = out.filter((m) => m.invite?.state === "sent").length;
      toast(sent === out.length ? (out.length === 1 ? `Invitation sent to ${list[0]}` : `${out.length} invitations sent`) : `${out.length === 1 ? "Invitation" : "Invitations"} queued. People shows when ${out.length === 1 ? "it goes" : "they go"} out.`);
      setEmails("");
      setOpen(false);
    } catch (e) {
      setError(problem(e));
    }
    setBusy(false);
    refresh();
  };
  return (
    <form className="card form" style={{ marginBottom: 22 }} onSubmit={(e) => { e.preventDefault(); if (list.length) void submit(); }}>
      {/* Addresses, then the access level they all get */}
      <div>
        <label htmlFor="emails">Email addresses</label>
        <textarea id="emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="e.g. dana@example.com, lee@example.com" style={{ minHeight: 64 }} autoFocus />
        <p className="muted small" style={{ margin: "6px 0 0" }}>They get an email from neon1 with a link to sign in. Only invited emails can sign in.</p>
      </div>
      <div>
        <label htmlFor="acc">Access</label>
        <select id="acc" value={access} onChange={(e) => setAccess(e.target.value as AccessLevel)} style={{ maxWidth: 360 }}>
          {(Object.keys(ACCESS) as AccessLevel[]).map((a) => <option key={a} value={a}>{ACCESS[a]}</option>)}
        </select>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={!list.length || busy}>{busy ? "Sending…" : `Send ${list.length > 1 ? `${list.length} invitations` : "invitation"}`}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
