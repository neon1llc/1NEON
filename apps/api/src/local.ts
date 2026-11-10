// apps/api/src/local.ts - Local, test, and browser-demo stand-ins for the outside services: files,
// sign-in accounts, and mail, all kept in memory. No AWS here, so the demo bundle stays small.


import type { Directory, Inspection, Mailer, ScanVerdict, Storage, Texter } from "./services.ts";


/** Local and test stand-ins */
/** Files in memory; the dev API serves the links, and anything stored counts as scanned clean */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, { type: string; bytes: Uint8Array }>();
  async putUrl(key: string) {
    return `/1NEON/api/dev-files/${encodeURIComponent(key)}`;
  }
  async getUrl(key: string) {
    return `/1NEON/api/dev-files/${encodeURIComponent(key)}`;
  }
  // Tests set a verdict per key (or a whole outcome) to walk files through each state
  verdicts = new Map<string, ScanVerdict>();
  inspections = new Map<string, Inspection>();
  async inspect(key: string): Promise<Inspection> {
    const set = this.inspections.get(key);
    if (set) return set;
    const f = this.files.get(key);
    return f ? { kind: "present", size: f.bytes.length } : { kind: "absent" };
  }
  async scan(key: string): Promise<ScanVerdict> {
    return this.verdicts.get(key) ?? (this.files.has(key) ? "clean" : "absent");
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}



export class MemoryDirectory implements Directory {
  // Emails that would have accounts, for assertions in tests
  readonly users = new Set<string>();
  // Record the invitee instead of calling Cognito
  async ensureUser(email: string) {
    this.users.add(email);
  }
  // Passkeys "added" here, and whether the factor lookup should fail, for tests to arrange
  passkeys = 0;
  failLookup = false;
  // Locally nobody has Cognito factors until a passkey is added; tests can make the lookup fail
  async factors() {
    if (this.failLookup) throw new Error("factor lookup unavailable");
    return { totp: false, passkeys: this.passkeys };
  }
  // Passkeys can't be made without a browser; local runs return fixed options and accept anything
  async startPasskey() {
    return { challenge: "bG9jYWw", rp: { id: "localhost", name: "1NEON" }, user: { id: "bG9jYWw", name: "local", displayName: "local" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] };
  }
  async finishPasskey() {
    this.passkeys++;
  }
}


// Keeps sent mail in memory so tests can read invites
export class MemoryMailer implements Mailer {
  // Every message sent, oldest first
  readonly sent: { to: string; subject: string; text: string; html: string; replyTo?: string }[] = [];
  // Record the message instead of sending it
  async send(to: string, subject: string, text: string, html: string, replyTo?: string) {
    this.sent.push({ to, subject, text, html, replyTo });
  }
}




// Keeps texts in memory so tests (and the demo) can read them
export class MemoryTexter implements Texter {
  readonly sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.sent.push({ to, body });
  }
}
