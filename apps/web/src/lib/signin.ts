// apps/web/src/lib/signin.ts - The sign-in step in progress, kept in sessionStorage so a reload
// (iOS Safari often reloads a tab after a trip to the mail app) returns to the code step. The
// server keeps Cognito's session in an HttpOnly cookie for five minutes, so a restored step can
// still be answered. The code itself is never stored.


// Where the step is kept, and how long it stays answerable
export const SIGNIN_KEY = "1neon.signin";
export const SIGNIN_TTL = 5 * 60 * 1000;


/** A step worth coming back to, with when it was saved */
export interface SavedStep {
  email: string;
  step: "choose" | "code" | "totp";
  methods?: ("code" | "passkey")[];
  at: number;
}


// The storage calls used here; sessionStorage in the app, a stand-in in tests
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;


/** Remember the step; storage errors (private browsing, a full quota) just mean no restore */
export function saveStep(store: Store | undefined, s: Omit<SavedStep, "at">, now = Date.now()) {
  const saved: SavedStep = { email: s.email, step: s.step, methods: s.methods, at: now };
  try {
    store?.setItem(SIGNIN_KEY, JSON.stringify(saved));
  } catch {
    // Nothing to restore later
  }
}


/** The saved step if it's well formed and under five minutes old; anything else is cleared */
export function loadStep(store: Store | undefined, now = Date.now()): SavedStep | undefined {
  try {
    const raw = store?.getItem(SIGNIN_KEY);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as Partial<SavedStep>;
    const fresh = typeof s.at === "number" && now - s.at >= 0 && now - s.at < SIGNIN_TTL;
    const shaped = typeof s.email === "string" && s.email !== "" && (s.step === "choose" || s.step === "code" || s.step === "totp");
    if (fresh && shaped) return { email: s.email!, step: s.step!, methods: Array.isArray(s.methods) ? s.methods : undefined, at: s.at! };
    store?.removeItem(SIGNIN_KEY);
  } catch {
    // Unreadable or unavailable: start from the email
  }
  return undefined;
}


/** Forget the step: after success, a failure, or "Use a different email" */
export function clearStep(store: Store | undefined) {
  try {
    store?.removeItem(SIGNIN_KEY);
  } catch {
    // Already unavailable
  }
}


/** Digits only, at most eight, so a pasted "1234 5678" or "1234-5678" works */
export function cleanCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}


/** sessionStorage, or nothing where reading it throws */
export function session(): Store | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
