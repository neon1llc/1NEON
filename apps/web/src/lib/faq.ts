// apps/web/src/lib/faq.ts - The FAQ page's data: questions parsed from help/faqs.md, each with a
// stable id that matches the knowledge center's copy, the everyday words people search with, and
// the search itself.


/** One question, its answer, and its anchor */
export interface Question {
  id: string;
  q: string;
  a: string;
}

/** One topic and its questions, parsed from "## Topic" and "### Question" headings */
export interface Topic {
  name: string;
  items: Question[];
}


/**
 * The anchor for a heading, built the way the knowledge center builds its own (lowercase, every run
 * of other characters one hyphen), so /1NEON/faqs#what-s-a-passkey and the knowledge page's
 * #what-s-a-passkey name the same answer
 */
export function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}


/** Split the Markdown into its intro and topics */
export function parse(md: string): { intro: string; topics: Topic[] } {
  const [head = "", ...rest] = md.split(/^## /m);
  const intro = head.replace(/^# .*$/m, "").trim();
  const topics = rest.map((block) => {
    const [name = "", ...qs] = block.split(/^### /m);
    return {
      name: name.trim(),
      items: qs.map((x) => {
        const [title = "", ...body] = x.split("\n");
        return { id: slug(title.trim()), q: title.trim(), a: body.join("\n").trim() };
      }),
    };
  });
  return { intro, topics };
}


// The words people reach for that an answer doesn't use itself, by question id. A search for any of
// them finds the answer
const ALIASES: Record<string, string[]> = {
  "i-lost-my-phone-or-my-authenticator-app": ["lost phone", "new phone", "lost device", "recovery", "recover", "locked out", "reset", "2fa", "mfa", "two-factor", "passkey"],
  "why-does-it-ask-me-to-confirm-it-s-me": ["2fa", "mfa", "two-factor", "step-up", "verification"],
  "what-s-a-passkey": ["2fa", "mfa", "fingerprint", "face id", "touch id", "webauthn"],
  "can-i-use-an-authenticator-app": ["2fa", "mfa", "totp", "google authenticator", "authy"],
  "where-are-invoices-and-payments": ["invoice", "invoices", "billing", "bill", "payment", "pay", "receipt"],
  "what-if-my-bank-payment-doesn-t-go-through": ["failed payment", "declined", "bounced", "returned", "insufficient funds", "nsf", "ach failed"],
  "is-there-a-fee-for-paying-by-card-or-for-paying-late": ["surcharge", "late fee", "interest", "penalty", "convenience fee", "overdue"],
  "what-if-i-think-an-invoice-is-wrong": ["dispute", "mistake", "error", "wrong amount", "overcharged", "question a charge"],
  "what-if-the-work-needs-more-hours-than-the-estimate": ["refund", "over budget", "overrun", "overage", "money back", "cap", "ceiling"],
  "is-a-price-fixed-or-an-estimate": ["quote", "hourly", "rate", "range", "price", "cost"],
  "something-urgent-is-wrong-who-do-i-tell": ["support", "urgent", "emergency", "outage", "down", "broken", "help", "incident"],
  "who-can-i-contact": ["support", "help", "email", "contact"],
  "can-we-get-a-copy-of-our-data": ["export", "download", "backup", "copy of data", "offboarding"],
  "what-happens-to-our-data-when-the-work-ends": ["retention", "delete", "deletion", "offboarding", "cancel", "leave", "export"],
  "my-email-address-changed": ["new email", "change email", "email change"],
  "who-do-i-ask-for-access": ["access", "permission", "invite"],
  "how-do-i-suggest-changes-to-a-proposal": ["markup", "mark up", "redline", "track changes", "docx", "word", "edit proposal"],
  "who-buys-equipment-or-software-for-a-project": ["purchase", "purchases", "buy", "hardware", "reimburse", "reimbursement", "receipt"],
  "what-if-we-need-something-new-after-approving": ["change request", "change order", "scope", "extra work", "add work"],
  "what-is-a-proposal-revision": ["quote", "estimate", "expired", "expiry", "price check", "refresh"],
};

/** Every question id that has aliases (for the test that each still names a real question) */
export const ALIAS_IDS = Object.keys(ALIASES);

/** The aliases for one question (exported for the tests) */
export const aliasesOf = (id: string) => ALIASES[id] ?? [];


/** Does a question answer this search? Every word of it must appear in the question, the answer,
 * or the question's aliases, in any order ("phone lost" finds "lost phone") */
export function matches(item: Question, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.q, item.a, ...aliasesOf(item.id)].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
