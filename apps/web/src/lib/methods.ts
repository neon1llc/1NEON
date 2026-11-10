// apps/web/src/lib/methods.ts - The one wording for how people sign in and how they confirm it's
// them. The sign-in screen renders these, and the terms, cookie notice, and FAQs repeat them word for
// word (methods.test.ts keeps them in step), so the portal never describes two different rules.


// What the sign-in screen offers: an emailed code, or a passkey once one is added (apps/api auth.ts)
export const SIGN_IN_METHODS = "Sign in with a code sent to your email, or with a passkey.";

// The step-up rule (packages/domain access.ts STRONG_AUTH): admin actions need a recent confirmation
// with any one enrolled factor (apps/api routes/factors.ts accepts all three)
export const CONFIRM_METHODS = "Inviting people, changing access or settings, and deleting also need a confirmation with a passkey, an authenticator app, or a text-message code.";
