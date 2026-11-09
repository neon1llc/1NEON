// apps/web/src/live/signin.ts - Sign-in for the short demos, in the browser. The real portal's
// sign-in runs through Cognito, which the demo doesn't have; this answers the same /auth/step calls
// with the same steps (email, then a code or a passkey), mails a real-looking code to the pretend
// inbox from the real template, and starts a session the API checks like a real one.


import { signInCodeEmail } from "../../../api/src/emails.ts";
import type { MemoryMailer } from "../../../api/src/local.ts";
import type { Repo } from "../../../api/src/store/repo.ts";


/** The signed-in session the in-browser API is told about, so "Confirm it's you" works for real */
export interface LiveSession { id: string; email: string }

// Where a sign-in stands between calls
let pending: { email: string; code?: string } | undefined;
let n = 0;

// The sign-in step the web app expects, as JSON
const reply = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/**
 * Answer one /auth/step call. `done` is called with the new session once a code or passkey checks out;
 * a passkey sign-in counts as confirmed, an emailed code doesn't, as in the real portal
 */
export async function liveStep(req: Request, repo: Repo, mailer: MemoryMailer, done: (s: LiveSession, uid: string) => void): Promise<Response> {
  const b = (await req.json()) as { op: string; email?: string; prefer?: string; method?: string; kind?: string; value?: string };
  // Mail a fresh eight-digit code from the real template
  const sendCode = async (email: string) => {
    const code = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
    pending = { email, code };
    const mail = signInCodeEmail({ code, portal: `${location.origin}/1NEON/live/` });
    await mailer.send(email, mail.subject, mail.text, mail.html);
    return reply({ step: "code" });
  };
  // Finish: a session row like the real one, and the person signed in
  const finish = async (strong: boolean) => {
    const email = pending!.email;
    const uid = (await repo.userIdForEmail(email))!;
    const id = `live-${++n}`;
    await repo.saveSession(id, uid, strong);
    pending = undefined;
    done({ id, email }, uid);
    return reply({ step: "done" });
  };
  if (b.op === "start") {
    const email = String(b.email ?? "").toLowerCase();
    const uid = await repo.userIdForEmail(email);
    if (!uid) return reply({ step: "not_invited" });
    const user = await repo.getUser(uid);
    pending = { email };
    // Confirm it's you with a passkey starts here too, asking for the passkey straight away
    if (b.prefer === "passkey") return reply(user?.passkey ? { step: "passkey", options: { challenge: "bGl2ZQ", rpId: location.hostname } } : { step: "failed" });
    if (user?.passkey) return reply({ step: "choose", methods: ["passkey", "code"] });
    return sendCode(email);
  }
  if (!pending) return reply({ step: "failed" });
  if (b.op === "choose") return b.method === "passkey" ? reply({ step: "passkey", options: { challenge: "bGl2ZQ", rpId: location.hostname } }) : sendCode(pending.email);
  if (b.kind === "passkey") return finish(true);
  if (b.kind === "code") return b.value === pending.code ? finish(false) : reply({ step: "code", wrong: true });
  return reply({ step: "failed" });
}
