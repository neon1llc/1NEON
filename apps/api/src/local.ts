// apps/api/src/local.ts - Local, test, and browser-demo stand-ins for the outside services: files,
// sign-in accounts, and mail, all kept in memory. No AWS here, so the demo bundle stays small.


import type { Directory, Mailer, Storage, Texter } from "./services.ts";


/** Local and test stand-ins */
/** Files in memory; the dev API serves the links, and everything counts as scanned clean */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, { type: string; bytes: Uint8Array }>();
  async putUrl(key: string) {
    return `/1NEON/api/dev-files/${encodeURIComponent(key)}`;
  }
  async getUrl(key: string) {
    return `/1NEON/api/dev-files/${encodeURIComponent(key)}`;
  }
  async stat(key: string) {
    return this.files.get(key)?.bytes.length;
  }
  async scan(key: string) {
    return this.files.has(key) ? "clean" as const : "pending" as const;
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
  // Local and test users count as strongly signed in, so admin actions can be exercised
  async hasStrongAuth() {
    return true;
  }
  // Passkeys can't be made without a browser; local runs return fixed options and accept anything
  async startPasskey() {
    return { challenge: "bG9jYWw", rp: { id: "localhost", name: "1NEON" }, user: { id: "bG9jYWw", name: "local", displayName: "local" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] };
  }
  async finishPasskey() {}
}


// Keeps sent mail in memory so tests can read invites
export class MemoryMailer implements Mailer {
  // Every message sent, oldest first
  readonly sent: { to: string; subject: string; text: string; html: string }[] = [];
  // Record the message instead of sending it
  async send(to: string, subject: string, text: string, html: string) {
    this.sent.push({ to, subject, text, html });
  }
}




// Keeps texts in memory so tests (and the demo) can read them
export class MemoryTexter implements Texter {
  readonly sent: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.sent.push({ to, body });
  }
}
