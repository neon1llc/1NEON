// apps/api/src/factors.ts - Which strong sign-in methods an account has enrolled. This answers "does
// this person have a passkey or authenticator?", never "did this session prove one?" (that is the
// session's own assurance, in repo.sessionStrong).


import type { User } from "@1neon/domain";
import type { Directory } from "./services.ts";
import type { Repo } from "./store/repo.ts";


/** Yes, no, or "we couldn't tell"; an unknown answer is never read as no */
export type Known = boolean | "unknown";


/** The enrolled factors, from the app's own authenticator record and from Cognito */
export interface FactorInventory {
  // The authenticator app that 1NEON itself checks (its seed lives in our table)
  totp: boolean;
  // Passkeys and Cognito's own authenticator setting
  passkey: Known;
  cognitoTotp: Known;
  // Any of the above; "unknown" when nothing is known enrolled and a lookup failed
  any: Known;
}


/**
 * Read the inventory. The app's own record is authoritative and a failed read of it throws, so the
 * request fails rather than guessing. A failed Cognito lookup becomes "unknown"; a passkey the
 * profile already recorded still counts, so an outage can only make an account look more enrolled.
 */
export async function factorInventory(repo: Repo, directory: Directory, user: User, accessToken: string): Promise<FactorInventory> {
  const totp = Boolean((await repo.getTotp(user.id))?.confirmed);
  const cognito = await directory.factors(accessToken).catch(() => undefined);
  const passkey: Known = cognito ? cognito.passkeys > 0 : user.passkey ? true : "unknown";
  const cognitoTotp: Known = cognito ? cognito.totp : "unknown";
  const any: Known = totp || passkey === true || cognitoTotp === true ? true : passkey === "unknown" || cognitoTotp === "unknown" ? "unknown" : false;
  return { totp, passkey, cognitoTotp, any };
}
