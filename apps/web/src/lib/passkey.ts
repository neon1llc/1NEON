// apps/web/src/lib/passkey.ts - Passkey sign-in: turns Cognito's request options into a browser
// prompt, and the signed result back into the JSON Cognito expects.


// WebAuthn uses base64url for every binary field
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const toB64 = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null);


// The parts of Cognito's CREDENTIAL_REQUEST_OPTIONS used here
interface RequestJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { id: string; type: "public-key"; transports?: AuthenticatorTransport[] }[];
}


/** Asks the browser for a passkey and returns the signed assertion as Cognito's CREDENTIAL value */
export async function passkeyAssertion(options: RequestJSON): Promise<string> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64(options.challenge),
      timeout: options.timeout,
      rpId: options.rpId,
      userVerification: options.userVerification,
      allowCredentials: options.allowCredentials?.map((c) => ({ ...c, id: fromB64(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was chosen.");
  const r = cred.response as AuthenticatorAssertionResponse;
  // Same shape as PublicKeyCredential.toJSON(), which not every browser has yet
  return JSON.stringify({
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: toB64(r.clientDataJSON),
      authenticatorData: toB64(r.authenticatorData),
      signature: toB64(r.signature),
      userHandle: toB64(r.userHandle),
    },
  });
}
